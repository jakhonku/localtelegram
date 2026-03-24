import sqlite3

DB_NAME = "messenger.db"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    # Users table - endi ism, familiya va IP asosiy bo'ladi
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT,
        last_name TEXT,
        ip_address TEXT UNIQUE
    )''')
    
    # Messages table
    c.execute('''CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_ip TEXT,
        receiver_ip TEXT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'sent',
        file_path TEXT,
        file_type TEXT
    )''')
    
    conn.commit()
    conn.close()

def execute_query(query, params=(), fetch=False, fetchall=False):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute(query, params)
    
    result = None
    if fetch:
        result = c.fetchone()
        if result:
            result = dict(result)
    elif fetchall:
        result = [dict(row) for row in c.fetchall()]
    else:
        conn.commit()
        result = c.lastrowid
        
    conn.close()
    return result
