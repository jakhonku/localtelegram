import webview
import threading
import uvicorn
import socket
import os
import sys

# Agar faqat bitta kompyuter server bo'lsa (yoki lokal ishlash uchun) API dasturini ham yashirincha qilib ishga tushirishi mumkin, 
# Lekin odatda bu shunchaki interfeys oynasini ochuvchi Desktop Client bo'ladi.

def main():
    # Frontend joylashgan papka
    current_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(current_dir, "frontend", "index.html")
    
    if not os.path.exists(frontend_dir):
        # build qilingan vaqtdagi (PyInstaller) yo'lni topish
        frontend_dir = os.path.join(sys._MEIPASS, "frontend", "index.html") if hasattr(sys, "_MEIPASS") else os.path.join(current_dir, "..", "frontend", "index.html")
        
    # PyWebView yordamida Chromium/Edge asosidagi oyna ochamiz
    webview.create_window(
        title="Institut Messenger",
        url=frontend_dir,
        width=1000,
        height=700,
        min_size=(800, 600)
    )
    
    webview.start()

if __name__ == '__main__':
    main()
