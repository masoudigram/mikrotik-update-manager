import ssl
from routeros_api import RouterOsApiPool
from paramiko import SSHClient, AutoAddPolicy
import yaml
import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename


app = Flask(__name__)
CORS(app)

ROUTEROS_PATH = os.path.join(os.path.dirname(__file__), '../os')
DEVICES_FILE = os.path.join(os.path.dirname(__file__), '/root/mikrotik_update/backend/devices.yaml')

def ensure_architecture_dir(arch):
    arch_dir = os.path.join(ROUTEROS_PATH, arch)
    if not os.path.exists(arch_dir):
        os.makedirs(arch_dir)
    return arch_dir

def get_router_info(ip, username, password, api_port):
    ssl._create_default_https_context = ssl._create_unverified_context
    connection = RouterOsApiPool(ip, username=username, password=password, port=api_port, plaintext_login=True)
    api = connection.get_api()
    system = api.get_resource('/system/resource').get()[0]
    packages = api.get_resource('/system/package').get()
    connection.disconnect()
    return {
        "architecture": system['architecture-name'],
        "current_version": packages[0]['version']
    }

def upload_package(ip, username, password, arch, ssh_port, desired_version):
    package_path = os.path.join(ROUTEROS_PATH, arch, f"routeros-{arch}-{desired_version}.npk")
    
    # Check if package file exists
    if not os.path.exists(package_path):
        raise FileNotFoundError(f"Package file not found for architecture {arch} and version {desired_version}")
    
    ssh = SSHClient()
    ssh.set_missing_host_key_policy(AutoAddPolicy())
    ssh.connect(ip, username=username, password=password, port=ssh_port)
    sftp = ssh.open_sftp()
    sftp.put(package_path, f"/routeros-upgrade-{arch}-{desired_version}.npk")
    sftp.close()
    ssh.close()

@app.route('/upload-package', methods=['POST'])
def upload_package_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if not file.filename.endswith('.npk'):
        return jsonify({'error': 'File must be a .npk package'}), 400
    
    arch = request.form.get('architecture')
    if not arch:
        return jsonify({'error': 'Architecture not specified'}), 400
    
    # Create architecture directory if it doesn't exist
    arch_dir = ensure_architecture_dir(arch)
    
    # Save the file
    filename = secure_filename(file.filename)
    file_path = os.path.join(arch_dir, filename)
    file.save(file_path)
    
    return jsonify({'status': 'success', 'message': 'Package uploaded successfully'})

@app.route('/check-package', methods=['GET'])
def check_package():
    arch = request.args.get('architecture')
    version = request.args.get('version')
    
    if not arch or not version:
        return jsonify({'error': 'Architecture and version are required'}), 400
    
    package_path = os.path.join(ROUTEROS_PATH, arch, f"routeros-{arch}-{version}.npk")
    exists = os.path.exists(package_path)
    
    return jsonify({
        'exists': exists,
        'path': package_path if exists else None
    })

@app.route('/ping')
def ping():
    return jsonify({'status': 'ok'})

@app.route('/devices', methods=['GET'])
def list_devices():
    with open(DEVICES_FILE) as f:
        devices = yaml.safe_load(f)['devices']
    return jsonify(devices)

@app.route('/devices', methods=['POST'])
def add_device():
    data = request.json
    try:
        # Get router info including architecture and current version
        info = get_router_info(data['ip'], data['username'], data['password'], data['api_port'])
        
        # Add architecture and current version to device data
        device_data = {
            'ip': data['ip'],
            'username': data['username'],
            'password': data['password'],
            'api_port': data['api_port'],
            'ssh_port': data['ssh_port'],
            'architecture': info['architecture'],
            'current_version': info['current_version'],
            'desired_version': data.get('desired_version', info['current_version'])
        }
        
        with open(DEVICES_FILE) as f:
            content = yaml.safe_load(f)
        devices = content.get('devices', [])
        devices.append(device_data)
        content['devices'] = devices
        with open(DEVICES_FILE, 'w') as f:
            yaml.safe_dump(content, f)
        return jsonify({'status': 'added', 'device': device_data})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/devices/<ip>', methods=['DELETE'])
def delete_device(ip):
    with open(DEVICES_FILE) as f:
        content = yaml.safe_load(f)
    devices = content.get('devices', [])
    devices = [d for d in devices if d['ip'] != ip]
    content['devices'] = devices
    with open(DEVICES_FILE, 'w') as f:
        yaml.safe_dump(content, f)
    return jsonify({'status': 'deleted'})

@app.route('/devices/<ip>', methods=['PUT'])
def update_device_info(ip):
    data = request.json
    try:
        with open(DEVICES_FILE) as f:
            content = yaml.safe_load(f)
        devices = content.get('devices', [])
        
        # Find and update the device
        for device in devices:
            if device['ip'] == ip:
                # Update basic info
                device.update({
                    'username': data['username'],
                    'password': data['password'],
                    'api_port': data['api_port'],
                    'ssh_port': data['ssh_port']
                })
                
                # Refresh router info
                info = get_router_info(ip, data['username'], data['password'], data['api_port'])
                device['architecture'] = info['architecture']
                device['current_version'] = info['current_version']
                device['desired_version'] = data.get('desired_version', info['current_version'])
                break
        
        content['devices'] = devices
        with open(DEVICES_FILE, 'w') as f:
            yaml.safe_dump(content, f)
        return jsonify({'status': 'updated'})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/update', methods=['POST'])
def update_device():
    data = request.json
    ip = data['ip']
    username = data['username']
    password = data['password']
    api_port = data['api_port']
    ssh_port = data['ssh_port']
    desired_version = data['desired_version']
    
    try:
        info = get_router_info(ip, username, password, api_port)
        if info['current_version'] != desired_version:
            try:
                upload_package(ip, username, password, info['architecture'], ssh_port, desired_version)
                return jsonify({'status': 'updating'})
            except FileNotFoundError as e:
                return jsonify({
                    'status': 'error',
                    'error': 'package_not_found',
                    'message': str(e),
                    'architecture': info['architecture']
                }), 404
        else:
            return jsonify({'status': 'already up-to-date'})
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': 'update_failed',
            'message': str(e)
        }), 500

@app.route('/refresh-device-info', methods=['POST'])
def refresh_device_info():
    data = request.json
    device_ips = data.get('ips', [])  # If empty, refresh all devices
    
    try:
        with open(DEVICES_FILE) as f:
            content = yaml.safe_load(f)
        devices = content.get('devices', [])
        
        updated_devices = []
        errors = []
        
        # If no specific IPs provided, refresh all devices
        if not device_ips:
            device_ips = [device['ip'] for device in devices]
        
        for device in devices:
            if device['ip'] in device_ips:
                try:
                    # Get current router info
                    info = get_router_info(
                        device['ip'],
                        device['username'],
                        device['password'],
                        device['api_port']
                    )
                    
                    # Update device info
                    device.update({
                        'architecture': info['architecture'],
                        'current_version': info['current_version']
                    })
                    updated_devices.append(device['ip'])
                except Exception as e:
                    errors.append({
                        'ip': device['ip'],
                        'error': str(e)
                    })
        
        # Save updated devices
        content['devices'] = devices
        with open(DEVICES_FILE, 'w') as f:
            yaml.safe_dump(content, f)
        
        return jsonify({
            'status': 'success',
            'updated_devices': updated_devices,
            'errors': errors
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/devices/bulk', methods=['POST'])
def bulk_add_devices():
    devices = request.json.get('devices', [])
    results = []
    for data in devices:
        try:
            # Get router info including architecture and current version
            info = get_router_info(data['ip'], data['username'], data['password'], data['api_port'])
            device_data = {
                'ip': data['ip'],
                'username': data['username'],
                'password': data['password'],
                'api_port': data['api_port'],
                'ssh_port': data['ssh_port'],
                'architecture': info['architecture'],
                'current_version': info['current_version'],
                'desired_version': info['current_version']
            }
            with open(DEVICES_FILE) as f:
                content = yaml.safe_load(f)
            existing = content.get('devices', [])
            # Avoid duplicates
            if any(d['ip'] == device_data['ip'] for d in existing):
                raise Exception('Device with this IP already exists')
            existing.append(device_data)
            content['devices'] = existing
            with open(DEVICES_FILE, 'w') as f:
                yaml.safe_dump(content, f)
            results.append({'ip': data['ip'], 'status': 'success'})
        except Exception as e:
            results.append({'ip': data.get('ip', ''), 'status': 'error', 'error': str(e)})
    return jsonify({'results': results})

if __name__ == '__main__':
    app.run(debug=True) 