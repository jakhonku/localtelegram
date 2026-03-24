import os
import socket
from datetime import datetime
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import socketio
import uvicorn

from database import init_db, execute_query

# Initialize DB
init_db()

UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

app = FastAPI(title="Institut LAN Messenger")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

class RegisterModel(BaseModel):
    first_name: str
    last_name: str
    ip_address: str = ""

@app.post("/register")
async def register(auth: RegisterModel, request: Request):
    client_ip = request.client.host
    existing = execute_query("SELECT * FROM users WHERE ip_address = ?", (client_ip,), fetch=True)
    if existing:
        execute_query("UPDATE users SET first_name=?, last_name=? WHERE ip_address=?", 
                      (auth.first_name, auth.last_name, client_ip))
    else:
        execute_query("INSERT INTO users (first_name, last_name, ip_address) VALUES (?, ?, ?)", 
                      (auth.first_name, auth.last_name, client_ip))
    return {"status": "success", "ip": client_ip}

@app.get("/login")
async def login(ip: str):
    user = execute_query("SELECT * FROM users WHERE ip_address = ?", (ip,), fetch=True)
    if not user:
        raise HTTPException(status_code=404, detail="User not found. Iltimos ro'yxatdan o'ting.")
    return {"status": "success", "user": user}

@app.get("/users")
async def get_users():
    users = execute_query("SELECT * FROM users", fetchall=True)
    return {"users": users}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())
    # fayl turini aniqlash (rasm, video yoki oddiy fayl)
    file_type = "file"
    if file.content_type and "image" in file.content_type:
        file_type = "image"
        
    return {"filename": file.filename, "path": f"/download/{file.filename}", "type": file_type}

@app.get("/download/{filename}")
async def download_file(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/messages/{ip1}/{ip2}")
async def get_messages(ip1: str, ip2: str):
    messages = execute_query("""
        SELECT * FROM messages 
        WHERE (sender_ip = ? AND receiver_ip = ?) OR (sender_ip = ? AND receiver_ip = ?)
        ORDER BY timestamp ASC
    """, (ip1, ip2, ip2, ip1), fetchall=True)
    return {"messages": messages}

# Tizimda kim onlayn ekanini kuzatish uchun
online_users = {} # {sid: ip}
user_sids = {} # {ip: set(sids)}

@sio.event
async def connect(sid, environ, auth):
    pass

@sio.event
async def disconnect(sid):
    if sid in online_users:
        ip = online_users[sid]
        del online_users[sid]
        if ip in user_sids:
            user_sids[ip].remove(sid)
            if not user_sids[ip]:
                del user_sids[ip]
                await sio.emit('user_status', {'ip_address': ip, 'status': 'offline'})

@sio.event
async def authenticate(sid, data):
    ip = data.get("ip_address")
    if ip:
        online_users[sid] = ip
        if ip not in user_sids:
            user_sids[ip] = set()
        user_sids[ip].add(sid)
        await sio.emit('user_status', {'ip_address': ip, 'status': 'online'})
        online_list = list(user_sids.keys())
        await sio.emit('online_users', {'users': online_list}, to=sid)

@sio.event
async def send_message(sid, data):
    sender_ip = online_users.get(sid)
    if not sender_ip:
        return
    
    receiver_ip = data.get("receiver_ip")
    content = data.get("content")
    file_path = data.get("file_path", "")
    file_type = data.get("file_type", "text")
    
    msg_id = execute_query("""
        INSERT INTO messages (sender_ip, receiver_ip, content, file_path, file_type, status)
        VALUES (?, ?, ?, ?, ?, 'sent')
    """, (sender_ip, receiver_ip, content, file_path, file_type))
    
    message_data = {
        "id": msg_id,
        "sender_ip": sender_ip,
        "receiver_ip": receiver_ip,
        "content": content,
        "file_path": file_path,
        "file_type": file_type,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "status": "sent"
    }

    if receiver_ip in user_sids:
        for r_sid in user_sids[receiver_ip]:
            await sio.emit('receive_message', message_data, to=r_sid)
            execute_query("UPDATE messages SET status = 'delivered' WHERE id = ?", (msg_id,))
            message_data["status"] = "delivered"
            await sio.emit('message_delivered', {"id": msg_id, "status": "delivered"}, to=sid)
            
    for s_sid in user_sids[sender_ip]:
        await sio.emit('receive_message', message_data, to=s_sid)

@sio.event
async def typing(sid, data):
    sender = online_users.get(sid)
    receiver = data.get("receiver_ip")
    if receiver in user_sids:
        for r_sid in user_sids[receiver]:
            await sio.emit('is_typing', {'sender_ip': sender}, to=r_sid)

# WebRTC Signaling uchun eventlar (Qo'ng'iroq qilish uchun)
@sio.event
async def call_user(sid, data):
    # data: { user_to_call: ip_address, signal_data: ... }
    caller = online_users.get(sid)
    receiver = data.get("user_to_call")
    signal_data = data.get("signal_data")
    if receiver in user_sids:
        for r_sid in user_sids[receiver]:
            await sio.emit("call_made", {"signal": signal_data, "caller_ip": caller}, to=r_sid)

@sio.event
async def make_answer(sid, data):
    # data: { to: ip_address, signal: ... }
    receiver = data.get("to")
    signal_data = data.get("signal")
    if receiver in user_sids:
        for r_sid in user_sids[receiver]:
            await sio.emit("answer_made", {"signal": signal_data}, to=r_sid)

@sio.event
async def reject_call(sid, data):
    receiver = data.get("to")
    if receiver in user_sids:
        for r_sid in user_sids[receiver]:
            await sio.emit("call_rejected", {}, to=r_sid)

@sio.event
async def end_call(sid, data):
    receiver = data.get("to")
    if receiver in user_sids:
        for r_sid in user_sids[receiver]:
            await sio.emit("call_ended", {}, to=r_sid)

if __name__ == "__main__":
    def get_local_ip():
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('10.255.255.255', 1))
            IP = s.getsockname()[0]
        except Exception:
            IP = '127.0.0.1'
        finally:
            s.close()
        return IP
    print("="*50)
    print(f"MARKAZIY LOKAL SERVER ISHGA TUSHDI: {get_local_ip()}:8000")
    print("="*50)
    uvicorn.run(socket_app, host="0.0.0.0", port=8000)
