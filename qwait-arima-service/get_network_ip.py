#!/usr/bin/env python3
"""
Network Configuration Helper for Q-Wait
Finds your local IP address for multi-device access
"""

import socket
import platform

def get_local_ip():
    """Get the local IP address of this machine"""
    try:
        # Create a socket and connect to an external server (doesn't actually send data)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return None

def get_hostname():
    """Get the hostname of this machine"""
    try:
        return socket.gethostname()
    except Exception:
        return "Unknown"

def print_network_info():
    """Print network configuration information"""
    print("=" * 70)
    print("🌐 Q-WAIT NETWORK CONFIGURATION")
    print("=" * 70)
    
    # Get system info
    system = platform.system()
    hostname = get_hostname()
    local_ip = get_local_ip()
    
    print(f"\n📱 System Information:")
    print(f"   Operating System: {system}")
    print(f"   Hostname: {hostname}")
    
    if local_ip:
        print(f"\n✅ Your Local IP Address: {local_ip}")
        print("\n" + "=" * 70)
        print("📋 CONFIGURATION STEPS:")
        print("=" * 70)
        
        print(f"\n1️⃣  Update Frontend (qwait-frontend/src/App.js):")
        print(f"   Replace:")
        print(f"     const API_URL = 'http://localhost:3000/api';")
        print(f"   With:")
        print(f"     const API_URL = 'http://{local_ip}:3000/api';")
        print(f"\n   Replace:")
        print(f"     const PEOPLE_COUNTER_URL = 'http://localhost:5001';")
        print(f"   With:")
        print(f"     const PEOPLE_COUNTER_URL = 'http://{local_ip}:5001';")
        
        print(f"\n2️⃣  Start Frontend with Network Access:")
        if system == "Windows":
            print(f"     set HOST=0.0.0.0 && npm start")
        else:
            print(f"     HOST=0.0.0.0 npm start")
        
        print(f"\n3️⃣  Access from Other Devices:")
        print(f"   Make sure devices are on the SAME WiFi network")
        print(f"   Open browser on phone/tablet:")
        print(f"   👉 http://{local_ip}:3001")
        
        print(f"\n4️⃣  Test URLs:")
        print(f"   Backend:        http://{local_ip}:3000")
        print(f"   Frontend:       http://{local_ip}:3001")
        print(f"   ARIMA Service:  http://{local_ip}:5000")
        print(f"   People Counter: http://{local_ip}:5001")
        
        print("\n" + "=" * 70)
        print("⚠️  IMPORTANT NOTES:")
        print("=" * 70)
        print("   • All devices must be on the SAME WiFi network")
        print("   • Firewall may block connections - allow ports 3000, 3001, 5000, 5001")
        print("   • Some routers have device isolation - disable if needed")
        print("   • Use http:// (not https://)")
        
        print("\n" + "=" * 70)
        print("🔥 FIREWALL COMMANDS:")
        print("=" * 70)
        
        if system == "Windows":
            print("\n   Windows Firewall (Run as Administrator):")
            print(f"   netsh advfirewall firewall add rule name=\"Q-Wait Backend\" dir=in action=allow protocol=TCP localport=3000")
            print(f"   netsh advfirewall firewall add rule name=\"Q-Wait Frontend\" dir=in action=allow protocol=TCP localport=3001")
            print(f"   netsh advfirewall firewall add rule name=\"Q-Wait ARIMA\" dir=in action=allow protocol=TCP localport=5000")
            print(f"   netsh advfirewall firewall add rule name=\"Q-Wait Counter\" dir=in action=allow protocol=TCP localport=5001")
        
        elif system == "Darwin":  # macOS
            print("\n   macOS Firewall:")
            print("   System Preferences > Security & Privacy > Firewall Options")
            print("   Add Python and Node.js to allowed apps")
        
        elif system == "Linux":
            print("\n   Linux (UFW Firewall):")
            print(f"   sudo ufw allow 3000/tcp")
            print(f"   sudo ufw allow 3001/tcp")
            print(f"   sudo ufw allow 5000/tcp")
            print(f"   sudo ufw allow 5001/tcp")
        
        print("\n" + "=" * 70)
        print("✅ Configuration guide complete!")
        print("=" * 70)
        print()
        
    else:
        print("\n❌ Could not detect local IP address")
        print("   Please check your network connection")
        print("\n   Alternative methods:")
        if system == "Windows":
            print("   Run: ipconfig")
            print("   Look for 'IPv4 Address'")
        else:
            print("   Run: ifconfig or ip addr")
            print("   Look for 'inet' address")
        print()

def save_config_file(ip_address):
    """Save IP configuration to a file for reference"""
    config_content = f"""# Q-Wait Network Configuration
# Generated automatically

# Your Local IP Address
LOCAL_IP={ip_address}

# Frontend URLs (Update in qwait-frontend/src/App.js)
API_URL=http://{ip_address}:3000/api
PEOPLE_COUNTER_URL=http://{ip_address}:5001

# Backend URLs (Already correct if using 0.0.0.0)
BACKEND_HOST=0.0.0.0
BACKEND_PORT=3000

# Access URLs
FRONTEND_URL=http://{ip_address}:3001
BACKEND_API=http://{ip_address}:3000
ARIMA_SERVICE=http://{ip_address}:5000
PEOPLE_COUNTER=http://{ip_address}:5001

# Remember:
# - All devices must be on the SAME WiFi
# - Allow ports in firewall: 3000, 3001, 5000, 5001
# - Start frontend with: HOST=0.0.0.0 npm start
"""
    
    try:
        with open('network_config.txt', 'w') as f:
            f.write(config_content)
        print(f"💾 Configuration saved to: network_config.txt")
    except Exception as e:
        print(f"⚠️  Could not save config file: {e}")

if __name__ == "__main__":
    print_network_info()
    
    local_ip = get_local_ip()
    if local_ip:
        save_config_file(local_ip)