import { useState, useEffect, useRef } from 'react';
import './App.css';
import * as XLSX from 'xlsx';
import { FaPlus, FaFileImport, FaSyncAlt, FaCheckSquare, FaSquare, FaTrashAlt } from 'react-icons/fa';

interface Device {
  ip: string;
  username: string;
  password: string;
  api_port: string;
  ssh_port: string;
  architecture: string;
  current_version: string;
  desired_version: string;
}

function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState({
    ip: '',
    username: '',
    password: '',
    api_port: '',
    ssh_port: '',
    desired_version: ''
  });
  const [status, setStatus] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<{ architecture: string; version: string } | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [filterArchitecture, setFilterArchitecture] = useState<string>('');
  const [filterVersion, setFilterVersion] = useState<string>('');
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [bulkDesiredVersion, setBulkDesiredVersion] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<{ [key: string]: string }>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{ [key: string]: string }>({});
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false);
  const [addDeviceError, setAddDeviceError] = useState<string>('');
  const [isAddingDevice, setIsAddingDevice] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importedDevices, setImportedDevices] = useState<Device[]>([]);
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ip: string, status: string, error?: string}[]|null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [editError, setEditError] = useState('');

  const selectAllRef = useRef<HTMLInputElement>(null);

  // Get unique architectures and versions
  const architectures = Array.from(new Set(devices.map(device => device.architecture))).filter(Boolean);
  const versions = Array.from(new Set(devices.map(device => device.current_version))).filter(Boolean);

  // Filter devices based on selected criteria
  const filteredDevices = devices.filter(device => {
    if (filterArchitecture && device.architecture !== filterArchitecture) return false;
    if (filterVersion && device.current_version !== filterVersion) return false;
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        device.ip.toLowerCase().includes(searchLower) ||
        device.username.toLowerCase().includes(searchLower) ||
        device.architecture.toLowerCase().includes(searchLower) ||
        device.current_version.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  // Select all filtered devices
  const handleSelectAll = () => {
    const newSelected = new Set(selectedDevices);
    filteredDevices.forEach(device => {
      newSelected.add(device.ip);
    });
    setSelectedDevices(newSelected);
  };

  // Deselect all devices
  const handleDeselectAll = () => {
    setSelectedDevices(new Set());
  };

  // Handle bulk update
  const handleBulkUpdate = async () => {
    if (!bulkDesiredVersion) {
      setStatus('Please enter a desired version');
      return;
    }

    setUpdateStatus({});
    const devicesToUpdate = devices.filter(device => selectedDevices.has(device.ip));
    
    for (const device of devicesToUpdate) {
      try {
        setUpdateStatus(prev => ({
          ...prev,
          [device.ip]: 'Updating...'
        }));

        const response = await fetch('http://localhost:5000/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...device,
            desired_version: bulkDesiredVersion
          })
        });
        
        const data = await response.json();
        
        if (response.status === 404 && data.error === 'package_not_found') {
          setUpdateStatus(prev => ({
            ...prev,
            [device.ip]: 'Package not found'
          }));
          setUploadInfo({
            architecture: device.architecture,
            version: bulkDesiredVersion
          });
          setShowUploadModal(true);
          break;
        } else if (!response.ok) {
          setUpdateStatus(prev => ({
            ...prev,
            [device.ip]: `Error: ${data.error || 'Update failed'}`
          }));
        } else {
          setUpdateStatus(prev => ({
            ...prev,
            [device.ip]: data.status
          }));
        }
      } catch (error) {
        setUpdateStatus(prev => ({
          ...prev,
          [device.ip]: `Error: ${error instanceof Error ? error.message : String(error)}`
        }));
      }
    }
    
    fetchDevices();
  };

  // Fetch devices on component mount
  useEffect(() => {
    fetchDevices();
  }, []);

  // Fetch devices from backend
  const fetchDevices = async () => {
    try {
      const response = await fetch('http://localhost:5000/devices');
      if (!response.ok) throw new Error('Failed to fetch devices');
      const data = await response.json();
      setDevices(data);
    } catch (error: unknown) {
      setStatus('Error fetching devices: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // Add a new device
  const handleAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddDeviceError('');
    setIsAddingDevice(true);
    try {
      const response = await fetch('http://localhost:5000/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to add device');
      setStatus('Device added successfully');
      setForm({
        ip: '',
        username: '',
        password: '',
        api_port: '',
        ssh_port: '',
        desired_version: ''
      });
      setShowAddDeviceModal(false);
      fetchDevices();
    } catch (error: unknown) {
      setAddDeviceError('Error adding device: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsAddingDevice(false);
    }
  };

  // Delete a device
  const handleDelete = async (ip: string) => {
    try {
      const response = await fetch(`http://localhost:5000/devices/${ip}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete device');
      setStatus('Device deleted successfully');
      fetchDevices();
    } catch (error: unknown) {
      setStatus('Error deleting device: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // Update a device
  const handleUpdate = async (device: Device) => {
    try {
      const response = await fetch('http://localhost:5000/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(device)
      });
      const data = await response.json();
      
      if (response.status === 404 && data.error === 'package_not_found') {
        setUploadInfo({
          architecture: device.architecture,
          version: device.desired_version
        });
        setShowUploadModal(true);
        setStatus(`Package not found for architecture ${device.architecture} and version ${device.desired_version}. Please upload the package file.`);
      } else if (!response.ok) {
        throw new Error(data.error || 'Failed to update device');
      } else {
        setStatus(`Device update status: ${data.status}`);
        fetchDevices();
      }
    } catch (error: unknown) {
      setStatus('Error updating device: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // Toggle device selection
  const toggleDeviceSelection = (ip: string) => {
    const newSelected = new Set(selectedDevices);
    if (newSelected.has(ip)) {
      newSelected.delete(ip);
    } else {
      newSelected.add(ip);
    }
    setSelectedDevices(newSelected);
  };

  // Handle file upload
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadInfo) return;

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('architecture', uploadInfo.architecture);

    try {
      const response = await fetch('http://localhost:5000/upload-package', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to upload package');
      
      setStatus('Package uploaded successfully. You can now try updating the device again.');
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadInfo(null);
    } catch (error: unknown) {
      setStatus('Error uploading package: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // Refresh device information
  const handleRefreshInfo = async (selectedOnly: boolean = false) => {
    setIsRefreshing(true);
    setRefreshStatus({});
    
    try {
      const ips = selectedOnly ? Array.from(selectedDevices) : [];
      const response = await fetch('http://localhost:5000/refresh-device-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips })
      });
      
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to refresh device info');
      
      // Update status for each device
      data.updated_devices.forEach((ip: string) => {
        setRefreshStatus(prev => ({
          ...prev,
          [ip]: 'Updated successfully'
        }));
      });
      
      data.errors.forEach((error: { ip: string; error: string }) => {
        setRefreshStatus(prev => ({
          ...prev,
          [error.ip]: `Error: ${error.error}`
        }));
      });
      
      setStatus(`Refreshed ${data.updated_devices.length} devices${data.errors.length ? ` (${data.errors.length} failed)` : ''}`);
      fetchDevices(); // Refresh the device list
    } catch (error: unknown) {
      setStatus('Error refreshing devices: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle Excel file upload and parse
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        // Map to Device[] and ensure all fields are strings
        const devices: Device[] = (json as any[]).map(row => ({
          ip: String(row.ip || row.IP || ''),
          username: String(row.username || row.Username || ''),
          password: String(row.password || row.Password || ''),
          api_port: String(row.api_port || row['API Port'] || ''),
          ssh_port: String(row.ssh_port || row['SSH Port'] || ''),
          architecture: String(row.architecture || row.Architecture || ''),
          current_version: String(row.current_version || row['Current Version'] || ''),
          desired_version: '' // not used, but required by Device interface
        }));
        setImportedDevices(devices);
      } catch (err) {
        setImportError('Failed to parse Excel file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Confirm import
  const handleConfirmImport = async () => {
    setIsImporting(true);
    setImportError('');
    setImportResults(null);
    try {
      const response = await fetch('http://localhost:5000/devices/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devices: importedDevices })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Bulk import failed');
      setImportResults(data.results);
      fetchDevices();
    } catch (err) {
      setImportError('Import failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsImporting(false);
    }
  };

  const handleEditClick = (device: Device) => {
    setEditDevice(device);
    setShowEditModal(true);
    setEditError('');
  };

  const handleEditChange = (field: keyof Device, value: string) => {
    if (!editDevice) return;
    setEditDevice({ ...editDevice, [field]: value });
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDevice) return;
    setIsEditing(true);
    setEditError('');
    try {
      const response = await fetch(`http://localhost:5000/devices/${editDevice.ip}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editDevice)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update device');
      setShowEditModal(false);
      setEditDevice(null);
      fetchDevices();
    } catch (error: any) {
      setEditError('Error updating device: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsEditing(false);
    }
  };

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        filteredDevices.some(device => selectedDevices.has(device.ip)) &&
        !filteredDevices.every(device => selectedDevices.has(device.ip));
    }
  }, [filteredDevices, selectedDevices]);

  return (
    <div className="container">
      <div className="status">{status}</div>

      {/* Action Bar */}
      <div className="action-bar">
        <div className="action-group">
          <button className="primary-btn" onClick={() => setShowAddDeviceModal(true)}>
            <FaPlus style={{ marginRight: 6 }} /> Add Device
          </button>
          <button className="primary-btn import-btn" onClick={() => setShowImportModal(true)}>
            <FaFileImport style={{ marginRight: 6 }} /> Import Devices
          </button>
          <button className="secondary-btn" onClick={() => setShowBulkUpdateModal(true)} disabled={selectedDevices.size === 0}>
            <FaSyncAlt style={{ marginRight: 6 }} /> Update Selected ({selectedDevices.size})
          </button>
        </div>
        <div className="action-group">
          <button className="secondary-btn" onClick={() => handleRefreshInfo(true)} disabled={isRefreshing || selectedDevices.size === 0}>
            <FaSyncAlt style={{ marginRight: 4 }} /> Refresh Selected ({selectedDevices.size})
          </button>
          <button className="secondary-btn" onClick={() => handleRefreshInfo(false)} disabled={isRefreshing}>
            <FaSyncAlt style={{ marginRight: 4 }} /> Refresh All
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="device-list">
          <div className="device-list-header">
            <div className="search-filter-group">
              <input
                className="search-input"
                type="text"
                placeholder="Search devices..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className="filter-group">
                <label>Architecture:</label>
                <select 
                  value={filterArchitecture} 
                  onChange={(e) => setFilterArchitecture(e.target.value)}
                >
                  <option value="">All Architectures</option>
                  {architectures.map(arch => (
                    <option key={arch} value={arch}>{arch}</option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label>Current Version:</label>
                <select 
                  value={filterVersion} 
                  onChange={(e) => setFilterVersion(e.target.value)}
                >
                  <option value="">All Versions</option>
                  {versions.map(version => (
                    <option key={version} value={version}>{version}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <h2>Devices</h2>
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={filteredDevices.length > 0 && filteredDevices.every(device => selectedDevices.has(device.ip))}
                    onChange={e => {
                      if (e.target.checked) {
                        const newSelected = new Set(selectedDevices);
                        filteredDevices.forEach(device => newSelected.add(device.ip));
                        setSelectedDevices(newSelected);
                      } else {
                        const newSelected = new Set(selectedDevices);
                        filteredDevices.forEach(device => newSelected.delete(device.ip));
                        setSelectedDevices(newSelected);
                      }
                    }}
                  />
                </th>
                <th>IP</th>
                <th>Username</th>
                <th>API Port</th>
                <th>SSH Port</th>
                <th>Architecture</th>
                <th>Current Version</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.length === 0 ? (
                <tr><td colSpan={9}>No devices found.</td></tr>
              ) : (
                filteredDevices.map(device => (
                  <tr key={device.ip}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedDevices.has(device.ip)}
                        onChange={() => toggleDeviceSelection(device.ip)}
                      />
                    </td>
                    <td>{device.ip}</td>
                    <td>{device.username}</td>
                    <td>{device.api_port}</td>
                    <td>{device.ssh_port}</td>
                    <td>{device.architecture}</td>
                    <td>{device.current_version}</td>
                    <td>{updateStatus[device.ip] || refreshStatus[device.ip] || ''}</td>
                    <td>
                      <button onClick={() => handleEditClick(device)} style={{ marginRight: 4 }}>Edit</button>
                      <button onClick={() => handleUpdate(device)}>Update</button>
                      <button onClick={() => handleDelete(device.ip)}><FaTrashAlt style={{ marginRight: 4 }} />Delete</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Device Modal */}
      {showAddDeviceModal && (
        <div className="modal">
          <div className="modal-content">
            <h2>Add Device</h2>
            {addDeviceError && (
              <div style={{ color: '#f44336', marginBottom: '1rem', fontWeight: 500 }}>
                {addDeviceError}
              </div>
            )}
            <form onSubmit={handleAddDevice}>
              <label htmlFor="add-ip">IP</label>
              <input id="add-ip" placeholder="IP" value={form.ip} onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} required />
              <label htmlFor="add-username">Username</label>
              <input id="add-username" placeholder="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
              <label htmlFor="add-password">Password</label>
              <input id="add-password" placeholder="Password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
              <label htmlFor="add-api-port">API Port</label>
              <input id="add-api-port" placeholder="API Port" value={form.api_port} onChange={e => setForm(f => ({ ...f, api_port: e.target.value }))} required />
              <label htmlFor="add-ssh-port">SSH Port</label>
              <input id="add-ssh-port" placeholder="SSH Port" value={form.ssh_port} onChange={e => setForm(f => ({ ...f, ssh_port: e.target.value }))} required />
              <div className="button-group">
                <button type="submit" disabled={isAddingDevice}>
                  {isAddingDevice ? 'Adding...' : 'Add Device'}
                </button>
                <button type="button" onClick={() => { setShowAddDeviceModal(false); setAddDeviceError(''); }} disabled={isAddingDevice}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Update Modal */}
      {showBulkUpdateModal && (
        <div className="modal">
          <div className="modal-content">
            <h2>Bulk Update Devices</h2>
            <p>Selected devices: {selectedDevices.size}</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              handleBulkUpdate();
              setShowBulkUpdateModal(false);
            }}>
              <div className="form-group">
                <label>Desired Version:</label>
                <input
                  type="text"
                  value={bulkDesiredVersion}
                  onChange={(e) => setBulkDesiredVersion(e.target.value)}
                  placeholder="Enter version (e.g., 7.11.2)"
                  required
                />
              </div>
              <div className="button-group">
                <button type="submit">Update Devices</button>
                <button type="button" onClick={() => setShowBulkUpdateModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && uploadInfo && (
        <div className="modal">
          <div className="modal-content">
            <h2>Upload Package File</h2>
            <p>Please upload the RouterOS package file for:</p>
            <p>Architecture: {uploadInfo.architecture}</p>
            <p>Version: {uploadInfo.version}</p>
            <form onSubmit={handleFileUpload}>
              <input
                type="file"
                accept=".npk"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                required
              />
              <div className="button-group">
                <button type="submit">Upload</button>
                <button type="button" onClick={() => {
                  setShowUploadModal(false);
                  setUploadFile(null);
                  setUploadInfo(null);
                }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Devices Modal */}
      {showImportModal && (
        <div className="modal">
          <div className="modal-content">
            <h2>Import Devices from Excel</h2>
            <input type="file" accept=".xlsx,.xls" onChange={handleImportFile} />
            {importError && <div className="add-device-error">{importError}</div>}
            {importedDevices.length > 0 && !importResults && (
              <>
                <div style={{ margin: '0.7rem 0', fontWeight: 500 }}>Preview ({importedDevices.length} devices):</div>
                <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: '0.97rem', background: '#f7fafc', borderRadius: 6, padding: '0.5rem' }}>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>IP</th>
                        <th>Username</th>
                        <th>API Port</th>
                        <th>SSH Port</th>
                        <th>Architecture</th>
                        <th>Current Version</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importedDevices.map((d, i) => (
                        <tr key={i}>
                          <td>{d.ip}</td>
                          <td>{d.username}</td>
                          <td>{d.api_port}</td>
                          <td>{d.ssh_port}</td>
                          <td>{d.architecture}</td>
                          <td>{d.current_version}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="button-group">
                  <button onClick={handleConfirmImport} disabled={isImporting}>
                    {isImporting ? 'Importing...' : 'Import Devices'}
                  </button>
                  <button type="button" onClick={() => { setShowImportModal(false); setImportedDevices([]); setImportError(''); setImportResults(null); }} disabled={isImporting}>Cancel</button>
                </div>
              </>
            )}
            {/* Show import results after import */}
            {importResults && (
              <>
                <div style={{ margin: '0.7rem 0', fontWeight: 500 }}>Import Results:</div>
                <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: '0.97rem', background: '#f7fafc', borderRadius: 6, padding: '0.5rem' }}>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>IP</th>
                        <th>Status</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResults.map((r, i) => (
                        <tr key={i}>
                          <td>{r.ip}</td>
                          <td style={{ color: r.status === 'success' ? '#388e3c' : '#f44336', fontWeight: 600 }}>{r.status}</td>
                          <td style={{ color: '#f44336' }}>{r.error || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="button-group">
                  <button type="button" onClick={() => { setShowImportModal(false); setImportedDevices([]); setImportError(''); setImportResults(null); }}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit Device Modal */}
      {showEditModal && editDevice && (
        <div className="modal">
          <div className="modal-content">
            <h2>Edit Device</h2>
            <form onSubmit={handleEditSave}>
              <label htmlFor="edit-ip">IP</label>
              <input id="edit-ip" value={editDevice.ip} disabled />
              <label htmlFor="edit-username">Username</label>
              <input id="edit-username" value={editDevice.username} onChange={e => handleEditChange('username', e.target.value)} required />
              <label htmlFor="edit-password">Password</label>
              <input id="edit-password" type="password" value={editDevice.password} onChange={e => handleEditChange('password', e.target.value)} required />
              <label htmlFor="edit-api-port">API Port</label>
              <input id="edit-api-port" value={editDevice.api_port} onChange={e => handleEditChange('api_port', e.target.value)} required />
              <label htmlFor="edit-ssh-port">SSH Port</label>
              <input id="edit-ssh-port" value={editDevice.ssh_port} onChange={e => handleEditChange('ssh_port', e.target.value)} required />
              <div className="button-group">
                <button type="submit" disabled={isEditing}>{isEditing ? 'Saving...' : 'Save'}</button>
                <button type="button" onClick={() => setShowEditModal(false)} disabled={isEditing}>Cancel</button>
              </div>
              {editError && <div className="add-device-error">{editError}</div>}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
