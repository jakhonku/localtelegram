// Barcha asosiy holatlar
let socket = null;
let currentIp = null;
let currentChatIp = null; // tanlangan chat IP manzili
let serverBaseUrl = "";
let users = [];
let onlineUsers = new Set();
let messages = {}; 
let typingTimeout = null;

// DOM 
const authModal = document.getElementById("authModal");
const appContainer = document.getElementById("appContainer");
const serverIpInput = document.getElementById("serverIp");
const myIpInput = document.getElementById("myIp");
const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");
const loginBtn = document.getElementById("loginBtn");
const authError = document.getElementById("authError");

const myAvatar = document.getElementById("myAvatar");
const myName = document.getElementById("myName");
const myIpDisplay = document.getElementById("myIpDisplay");
const chatList = document.getElementById("chatList");
const searchInput = document.getElementById("searchInput");

const emptyState = document.getElementById("emptyState");
const activeChat = document.getElementById("activeChat");
const chatAvatar = document.getElementById("chatAvatar");
const chatName = document.getElementById("chatName");
const chatIpDisplay = document.getElementById("chatIp");
const typingIndicator = document.getElementById("typingIndicator");
const messagesList = document.getElementById("messagesList");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");

// WebRTC variables
let localStream;
let peerConnection;
let callingTo = null;

const configuration = {
    'iceServers': [
        // Internet bo'lmagani uchun lokal STUN / faqat host network
    ]
};

// Auto-login from database IP or local storage
window.addEventListener("DOMContentLoaded", async () => {
    let base = window.location.origin;
    if (base.startsWith("file://")) base = "http://127.0.0.1:8000";

    try {
        const res = await fetch(`${base}/me`);
        const data = await res.json();
        if (data.status === "success") {
            firstNameInput.value = data.user.first_name;
            lastNameInput.value = data.user.last_name;
            loginBtn.click();
            return;
        }
    } catch(err) {
        console.log("No registered IP found");
    }

    const savedFirstName = localStorage.getItem("firstName");
    const savedLastName = localStorage.getItem("lastName");
    if (savedFirstName && savedLastName) {
        firstNameInput.value = savedFirstName;
        lastNameInput.value = savedLastName;
        loginBtn.click();
    }
});

// Auth
loginBtn.addEventListener("click", async () => {
    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();

    if (!firstName || !lastName) {
        showAuthError("Ism va familiyani kiriting!");
        return;
    }

    serverBaseUrl = window.location.origin;
    if (serverBaseUrl.startsWith("file://")) {
        serverBaseUrl = "http://127.0.0.1:8000";
    }
    
    try {
        const res = await fetch(`${serverBaseUrl}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ first_name: firstName, last_name: lastName })
        });
        
        const data = await res.json();
        if (res.ok) {
            currentIp = data.ip; // Serverdan qaytgan haqiqiy IP
            
            // Saqlash (brauzer yopilganda so'ramasligi uchun)
            localStorage.setItem("firstName", firstName);
            localStorage.setItem("lastName", lastName);

            initSocket();
            
            myName.textContent = `${firstName} ${lastName}`;
            myAvatar.textContent = firstName.charAt(0);
            myIpDisplay.textContent = currentIp;

            authModal.classList.add("hidden");
            appContainer.classList.remove("hidden");
            fetchUsers();
            
            // So'raymiz mikrofon uchun ruxsat
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    localStream = stream;
                })
                .catch(err => console.log("Mikrofon topilmadi yoki ruxsat yo'q", err));
                
        } else {
            showAuthError(data.detail || "Xatolik yuz berdi");
        }
    } catch (err) {
        showAuthError("Markaziy serverga ulanib bo'lmadi! " + err.message);
    }
});

function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove("hidden");
}

function initSocket() {
    socket = io(serverBaseUrl);

    socket.on("connect", () => {
        socket.emit("authenticate", { ip_address: currentIp });
    });

    socket.on("online_users", (data) => {
        onlineUsers = new Set(data.users);
        renderChatList();
    });

    socket.on("user_status", (data) => {
        if (data.status === 'online') {
            onlineUsers.add(data.ip_address);
        } else {
            onlineUsers.delete(data.ip_address);
        }
        renderChatList();
    });

    socket.on("receive_message", (msg) => {
        const otherUserIp = msg.sender_ip === currentIp ? msg.receiver_ip : msg.sender_ip;
        if (!messages[otherUserIp]) messages[otherUserIp] = [];
        messages[otherUserIp].push(msg);
        
        if (currentChatIp === otherUserIp) {
            renderMessages();
            scrollToBottom();
        }
        renderChatList();
    });

    socket.on("message_delivered", (data) => {
        Object.keys(messages).forEach(ip => {
            messages[ip].forEach(msg => {
                if (msg.id === data.id) msg.status = "delivered";
            });
        });
        if (currentChatIp) renderMessages();
    });

    socket.on("is_typing", (data) => {
        if (currentChatIp === data.sender_ip) {
            typingIndicator.classList.remove("hidden");
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                typingIndicator.classList.add("hidden");
            }, 2000);
        }
    });

    // WebRTC Signaling listeners
    socket.on("call_made", async (data) => {
        // data.caller_ip, data.signal
        document.getElementById('callModal').classList.remove('hidden');
        document.getElementById('callerName').textContent = getUserFullName(data.caller_ip);
        
        document.getElementById('acceptCallBtn').onclick = async () => {
            document.getElementById('callModal').classList.add('hidden');
            await answerCall(data.caller_ip, data.signal);
        };
        
        document.getElementById('rejectCallBtn').onclick = () => {
            document.getElementById('callModal').classList.add('hidden');
            socket.emit("reject_call", { to: data.caller_ip });
        };
    });

    socket.on("answer_made", async (data) => {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
            document.getElementById("activeCallUI").classList.remove("hidden");
            document.getElementById("activeCallName").textContent = getUserFullName(currentChatIp);
        }
    });

    socket.on("call_rejected", () => {
        alert("Foydalanuvchi qo'ng'iroqni rad etdi.");
        endCallLocal();
    });

    socket.on("call_ended", () => {
        endCallLocal();
    });

    setInterval(fetchUsers, 5000); // 5 sek har yangilab turish
}

async function fetchUsers() {
    try {
        const res = await fetch(`${serverBaseUrl}/users`);
        const data = await res.json();
        users = data.users.filter(u => u.ip_address !== currentIp);
        renderChatList();
    } catch (err) {
        console.error("Foydalanuvchilarni yuklashda xatolik", err);
    }
}

function getUserFullName(ip) {
    const u = users.find(x => x.ip_address === ip);
    return u ? `${u.first_name} ${u.last_name}` : ip;
}

function renderChatList() {
    const query = searchInput.value.toLowerCase();
    chatList.innerHTML = "";
    
    users.forEach(user => {
        const fullName = `${user.first_name} ${user.last_name}`;
        if (!fullName.toLowerCase().includes(query) && !user.ip_address.includes(query)) return;
        
        const isOnline = onlineUsers.has(user.ip_address);
        let userMessages = messages[user.ip_address] || [];
        let lastMsg = userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
        
        let lastMsgText = "<i>Xabar yo'q</i>";
        if (lastMsg) {
            lastMsgText = lastMsg.sender_ip === currentIp ? "Siz: " : "";
            if (lastMsg.file_type === 'image') lastMsgText += "[Rasm]";
            else if (lastMsg.file_type === 'file') lastMsgText += "[Fayl]";
            else lastMsgText += escapeHTML(lastMsg.content);
        }

        const div = document.createElement("div");
        div.className = `p-3 flex items-center border-b cursor-pointer hover:bg-gray-50 transition border-gray-100 ${currentChatIp === user.ip_address ? 'bg-blue-50 border-l-[3px] border-l-blue-500' : 'border-l-[3px] border-l-transparent'}`;
        div.onclick = () => openChat(user.ip_address);
        
        const avatarColor = getAvatarColor(user.ip_address);

        div.innerHTML = `
            <div class="relative min-w-[48px]">
                <div class="w-12 h-12 rounded-full flex items-center justify-center ${avatarColor} text-white font-bold text-lg shadow-sm">
                    ${user.first_name.charAt(0)}
                </div>
                <div class="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${isOnline ? 'bg-green-500' : 'bg-gray-400'} shadow-sm"></div>
            </div>
            <div class="ml-3 flex-1 overflow-hidden">
                <div class="flex justify-between items-center mb-0.5">
                    <span class="font-semibold text-[15px] truncate">${fullName}</span>
                    <span class="text-xs text-gray-400 font-medium">${lastMsg ? lastMsg.timestamp.split(" ")[1].substring(0,5) : ''}</span>
                </div>
                <p class="text-sm text-gray-500 truncate leading-tight">${lastMsgText}</p>
            </div>
        `;
        chatList.appendChild(div);
    });
}

searchInput.addEventListener("input", renderChatList);

function getAvatarColor(str) {
    const colors = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500', 'bg-teal-500', 'bg-orange-500'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

async function openChat(ip) {
    currentChatIp = ip;
    const user = users.find(u => u.ip_address === ip);
    const fullName = `${user.first_name} ${user.last_name}`;

    emptyState.classList.add("hidden");
    activeChat.classList.remove("hidden");
    
    chatName.textContent = fullName;
    chatIpDisplay.textContent = ip;
    chatAvatar.textContent = user.first_name.charAt(0);
    chatAvatar.className = `w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm ${getAvatarColor(ip)}`;

    renderChatList(); 
    
    if (!messages[ip]) {
        try {
            const res = await fetch(`${serverBaseUrl}/messages/${currentIp}/${ip}`);
            const data = await res.json();
            messages[ip] = data.messages;
        } catch(err) {
            console.error(err);
            messages[ip] = [];
        }
    }
    
    renderMessages();
    setTimeout(scrollToBottom, 50);
}

function renderMessages() {
    messagesList.innerHTML = "";
    if(!messages[currentChatIp]) return;

    let lastDate = "";

    messages[currentChatIp].forEach(msg => {
        const isMine = msg.sender_ip === currentIp;
        const timestamp = msg.timestamp; 
        const dateStr = timestamp.split(" ")[0]; 
        const timeStr = timestamp.split(" ")[1].substring(0,5); 

        if (dateStr !== lastDate) {
            const dateHeader = document.createElement("div");
            dateHeader.className = `flex justify-center my-3`;
            dateHeader.innerHTML = `<span class="bg-white/80 text-[#3b4a54] text-xs font-semibold px-3 py-1 rounded-full shadow-sm">${dateStr}</span>`;
            messagesList.appendChild(dateHeader);
            lastDate = dateStr;
        }

        let statusIcon = "";
        if (isMine) {
            statusIcon = msg.status === 'delivered' 
                ? '<i class="fas fa-check-double text-[#4fc3f7] text-[10px]"></i>' 
                : '<i class="fas fa-check text-gray-400 text-[10px]"></i>';
        }

        let contentHtml = "";
        if (msg.file_type === 'image') {
            contentHtml = `<img src="${serverBaseUrl}${msg.file_path}" class="message-image" onclick="showFullImage(this.src)">`;
            if(msg.content && msg.content !== msg.file_path.split("/").pop()) {
                contentHtml += `<p>${escapeHTML(msg.content)}</p>`;
            }
        } 
        else if (msg.file_type === 'file') {
            contentHtml = `<a href="${serverBaseUrl}${msg.file_path}" target="_blank" class="text-blue-600 hover:text-blue-800 underline flex items-center gap-1.5 font-medium bg-white/50 p-2 rounded-lg mb-1"><i class="fas fa-file-download text-lg"></i> ${escapeHTML(msg.content)}</a>`;
        } 
        else {
            contentHtml = escapeHTML(msg.content);
        }

        const div = document.createElement("div");
        div.className = `flex ${isMine ? 'justify-end' : 'justify-start'} group`;
        div.innerHTML = `
            <div class="max-w-[75%] rounded-2xl px-3 py-1.5 flex flex-col relative shadow-sm ${isMine ? 'bg-[#d1f4cc] rounded-br-md' : 'bg-white rounded-bl-md border border-gray-100'}">
                <div class="text-[15px] text-[#111b21] leading-snug break-words" style="padding-bottom: 2px;">${contentHtml}</div>
                <div class="text-[10px] text-gray-500 text-right mt-0.5 flex justify-end items-center gap-1.5 self-end float-right">
                    <span>${timeStr}</span>
                    ${statusIcon}
                </div>
            </div>
        `;
        messagesList.appendChild(div);
    });
}

function scrollToBottom() {
    messagesList.scrollTop = messagesList.scrollHeight;
}

function showFullImage(src) {
    document.getElementById("fullImage").src = src;
    document.getElementById("imageModal").classList.remove("hidden");
}

async function sendMessage() {
    if (!currentChatIp) return;
    const content = messageInput.value.trim();
    if (!content) return;

    socket.emit("send_message", {
        receiver_ip: currentChatIp,
        content: content,
        file_path: "",
        file_type: "text"
    });
    messageInput.value = "";
    messageInput.style.height = 'auto';
}

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    } else {
        socket.emit("typing", { receiver_ip: currentChatIp });
    }
});

messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

attachBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentChatIp) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch(`${serverBaseUrl}/upload`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        
        socket.emit("send_message", {
            receiver_ip: currentChatIp,
            content: file.name,
            file_path: data.path,
            file_type: data.type
        });
        fileInput.value = ""; 
    } catch(err) {
        console.error("Yuklashda xatolik", err);
        alert("Fayl yuklash amalga oshmadi!");
    }
});

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// ----------------------
// Audio Call WebRTC Logic
// ----------------------
document.getElementById('callBtn').addEventListener('click', async () => {
    if(!localStream) {
        alert("Mikrofon ruxsati berilmagan!");
        return;
    }
    callingTo = currentChatIp;
    
    peerConnection = new RTCPeerConnection(configuration);
    
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            // Signal ice candidate
        }
    };

    peerConnection.ontrack = event => {
        document.getElementById("remoteAudio").srcObject = event.streams[0];
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit("call_user", {
        user_to_call: callingTo,
        signal_data: offer
    });

    document.getElementById("activeCallUI").classList.remove("hidden");
    document.getElementById("activeCallName").textContent = "Gudok ketmoqda...";
});

async function answerCall(callerIp, offerData) {
    callingTo = callerIp;
    peerConnection = new RTCPeerConnection(configuration);
    
    if(localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = event => {
        document.getElementById("remoteAudio").srcObject = event.streams[0];
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerData));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("make_answer", {
        to: callerIp,
        signal: answer
    });

    document.getElementById("activeCallUI").classList.remove("hidden");
    document.getElementById("activeCallName").textContent = getUserFullName(callerIp);
}

document.getElementById('endCallBtn').addEventListener('click', () => {
    if(callingTo) {
        socket.emit("end_call", { to: callingTo });
    }
    endCallLocal();
});

function endCallLocal() {
    if(peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    callingTo = null;
    document.getElementById("activeCallUI").classList.add("hidden");
    document.getElementById("remoteAudio").srcObject = null;
}
