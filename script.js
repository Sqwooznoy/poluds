// Global state
let currentChannel = 'general';
let channels = { 'general': [], 'random': [] };
let servers = [];
let inCall = false;
let localStream = null;
let screenStream = null;
let peerConnections = {};
let isVideoEnabled = true;
let isAudioEnabled = true;
let isMuted = false;
let isDeafened = false;
let currentUser = null;
let socket = null;
let token = null;
let currentView = 'friends';
let currentServerId = null;
let currentDMUserId = null;
let currentDMUsername = null;
let currentGroupId = null;
let currentGroupName = null;
let currentGroupOwnerId = null;
let screenShareWidth = 1920;
let screenShareHeight = 1080;
let screenShareFps = 60;
let ringtoneAudio = null;
let rnnoiseModule = null;
let rnnoiseReadyPromise = null;
let rnnoiseAudioContext = null;
let rnnoiseSourceNode = null;
let rnnoiseNode = null;
let rnnoiseDestination = null;
let processedAudioStream = null;
let rawAudioStream = null;
let participantNames = {};
let participantAvatars = {};
let participantVolumes = {};
let remoteAudioContext = null;
let remoteAudioGraphs = {};
let volumeMenuGlobalListenerAttached = false;
let lonelyCallTimeout = null;
let hadPeerInCall = false;
let callBannerTimer = null;
let callStartTime = null;
let callSessionActive = false;
let settingsState = {
    activeSection: 'account'
};
let appSettings = {
    theme: 'dark',
    fontSize: 16,
    notifications: true,
    sounds: true,
    safeContent: 'scan_all',
    allowFriendRequests: true,
    rnnoise: true,
    echoCancellation: true,
    browserNoiseSuppression: true,
    integrations: {
        github: false,
        spotify: false
    },
    nitroPlan: null,
    boosts: 0,
    billingMethods: [],
    billingHistory: [],
    passwordLastChanged: null
};
let lastMessageDayKey = null;
let lastMessageAuthor = null;
let lastMessageTimestamp = 0;

function loadAppSettings() {
    try {
        const stored = localStorage.getItem('appSettings');
        if (stored) {
            const parsed = JSON.parse(stored);
            appSettings = { ...appSettings, ...parsed, integrations: { ...appSettings.integrations, ...parsed.integrations } };
        }
    } catch (e) {
        console.warn('Failed to load settings, using defaults', e);
    }
    applyThemeSettings();
    applyFontSizeSetting();
}

function saveAppSettings() {
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
}

function applyThemeSettings() {
    document.documentElement.classList.toggle('theme-light', appSettings.theme === 'light');
    document.documentElement.classList.toggle('theme-dark', appSettings.theme !== 'light');
}

function applyFontSizeSetting() {
    document.documentElement.style.fontSize = `${appSettings.fontSize || 16}px`;
}

function setSetting(keyPath, value) {
    const parts = keyPath.split('.');
    if (parts.length === 1) {
        appSettings[keyPath] = value;
    } else {
        let obj = appSettings;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!obj[parts[i]]) obj[parts[i]] = {};
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
    }
    saveAppSettings();
    if (keyPath === 'theme') applyThemeSettings();
    if (keyPath === 'fontSize') applyFontSizeSetting();
}
const settingsTemplates = {
    account: () => `
        <div class="setting-card">
            <h4>Profile</h4>
            <div class="setting-row">
                <label>Username</label>
                <form id="usernameForm" class="settings-inline-form">
                    <input id="settingsUsername" class="settings-input" type="text" value="${currentUser?.username || ''}" minlength="3" maxlength="20" />
                    <button type="submit" class="call-banner-btn">Save</button>
                </form>
            </div>
            <div class="setting-row">
                <label>Email</label>
                <input class="settings-input" type="email" value="hidden@example.com" disabled />
            </div>
        </div>
        <div class="setting-card">
            <h4>Security</h4>
            <div class="setting-row">
                <label>Change Password</label>
                <form id="passwordForm" class="settings-inline-form">
                    <input id="currentPassword" class="settings-input" type="password" placeholder="Current" required />
                    <input id="newPassword" class="settings-input" type="password" placeholder="New (min 6)" minlength="6" required />
                    <button type="submit" class="call-banner-btn">Update</button>
                </form>
            </div>
            <div class="setting-row">
                <label>Last changed</label>
                <span>${appSettings.passwordLastChanged ? new Date(appSettings.passwordLastChanged).toLocaleString() : 'Never'}</span>
            </div>
        </div>
    `,
    privacy: () => `
        <div class="setting-card">
            <h4>Content & Privacy</h4>
            <div class="setting-row">
                <label>Safe content filter</label>
                <select class="settings-select" data-setting="safeContent">
                    <option value="scan_all">Scan all content</option>
                    <option value="strangers_only">Only from strangers</option>
                    <option value="do_not_scan">Do not scan</option>
                </select>
            </div>
            <div class="setting-row">
                <label>Allow friend requests</label>
                <label class="switch"><input class="settings-switch-checkbox" data-setting="allowFriendRequests" type="checkbox"><span class="slider"></span></label>
            </div>
        </div>
    `,
    apps: () => `
        <div class="setting-card">
            <h4>Authorized Apps</h4>
            <div class="setting-row">
                <label>No connected apps yet.</label>
            </div>
        </div>
    `,
    devices: () => `
        <div class="setting-card">
            <h4>Devices</h4>
            <div class="setting-row">
                <label>Current device</label>
                <span>${navigator.platform || 'Unknown'}</span>
            </div>
            <div class="setting-row">
                <label>Log out from all devices</label>
                <button id="logoutAllDevicesBtn" class="call-banner-btn danger">Log out</button>
            </div>
        </div>
    `,
    integrations: () => `
        <div class="setting-card">
            <h4>Integrations</h4>
            <div class="setting-row">
                <label>GitHub</label>
                <button id="integration-github" class="call-banner-btn">Connect</button>
            </div>
            <div class="setting-row">
                <label>Spotify</label>
                <button id="integration-spotify" class="call-banner-btn">Connect</button>
            </div>
        </div>
    `,
    nitro: () => `
        <div class="setting-card">
            <h4>Nitro</h4>
            <div class="setting-row">
                <label>${appSettings.nitroPlan ? `Active plan: ${appSettings.nitroPlan}` : 'Unlock HD video, larger uploads, and more.'}</label>
                <button class="call-banner-btn" data-action="open-nitro">${appSettings.nitroPlan ? 'Manage' : 'Subscribe'}</button>
            </div>
        </div>
    `,
    boosts: () => `
        <div class="setting-card">
            <h4>Server Boost</h4>
            <div class="setting-row">
                <label>Boosts owned: ${appSettings.boosts}</label>
                <button class="call-banner-btn" data-action="open-boost">Boost</button>
            </div>
        </div>
    `,
    subscriptions: () => `
        <div class="setting-card">
            <h4>Subscriptions</h4>
            <div class="setting-row">
                <label>${appSettings.nitroPlan ? `Active: ${appSettings.nitroPlan}` : 'You have no active subscriptions.'}</label>
            </div>
        </div>
    `,
    billing: () => `
        <div class="setting-card">
            <h4>Billing</h4>
            <div class="setting-row">
                <label>Payment methods (${appSettings.billingMethods.length})</label>
                <button class="call-banner-btn" data-action="add-payment">Add</button>
            </div>
            <div class="setting-row">
                <label>Billing history (${appSettings.billingHistory.length})</label>
                <button class="call-banner-btn" data-action="view-billing">View</button>
            </div>
        </div>
    `,
    appearance: () => `
        <div class="setting-card">
            <h4>Appearance</h4>
            <div class="setting-row">
                <label>Theme</label>
                <select class="settings-select" data-setting="theme">
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                </select>
            </div>
            <div class="setting-row">
                <label>Font size</label>
                <input class="settings-input" data-setting="fontSize" type="range" min="12" max="20" value="16" />
            </div>
        </div>
    `,
    voice: () => `
        <div class="setting-card">
            <h4>Voice & Video</h4>
            <div class="setting-row">
                <label>Input device</label>
                <select class="settings-select">
                    <option>Default microphone</option>
                </select>
            </div>
            <div class="setting-row">
                <label>Noise suppression</label>
                <label class="switch"><input class="settings-switch-checkbox" data-setting="rnnoise" type="checkbox"><span class="slider"></span></label>
            </div>
            <div class="setting-row">
                <label>Browser noise suppression</label>
                <label class="switch"><input class="settings-switch-checkbox" data-setting="browserNoiseSuppression" type="checkbox"><span class="slider"></span></label>
            </div>
            <div class="setting-row">
                <label>Echo cancellation</label>
                <label class="switch"><input class="settings-switch-checkbox" data-setting="echoCancellation" type="checkbox"><span class="slider"></span></label>
            </div>
        </div>
    `,
    notifications: () => `
        <div class="setting-card">
            <h4>Notifications</h4>
            <div class="setting-row">
                <label>Enable desktop notifications</label>
                <label class="switch"><input class="settings-switch-checkbox" data-setting="notifications" type="checkbox"><span class="slider"></span></label>
            </div>
            <div class="setting-row">
                <label>Sounds</label>
                <label class="switch"><input class="settings-switch-checkbox" data-setting="sounds" type="checkbox"><span class="slider"></span></label>
            </div>
        </div>
    `
};

function rememberParticipant(socketId, username, avatar) {
    if (!socketId) return;
    participantNames[socketId] = username || participantNames[socketId] || 'Friend';
    if (avatar) {
        participantAvatars[socketId] = avatar;
    }
}

function forgetParticipant(socketId) {
    if (!socketId) return;
    delete participantNames[socketId];
    delete participantAvatars[socketId];
}

function getParticipantName(socketId) {
    if (socketId && participantNames[socketId]) {
        return participantNames[socketId];
    }
    if (window.currentCallDetails?.peerSocketId === socketId && window.currentCallDetails?.peerName) {
        return window.currentCallDetails.peerName;
    }
    if (window.currentCallDetails?.friendName) {
        return window.currentCallDetails.friendName;
    }
    return 'Friend';
}

function getParticipantAvatar(socketId, fallbackLetter) {
    if (socketId && participantAvatars[socketId]) {
        return participantAvatars[socketId];
    }
    if (window.currentCallDetails?.peerSocketId === socketId && window.currentCallDetails?.peerAvatar) {
        return window.currentCallDetails.peerAvatar;
    }
    if (window.currentCallDetails?.friendAvatar) {
        return window.currentCallDetails.friendAvatar;
    }
    return fallbackLetter || 'U';
}

function formatCallDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function stopCallBannerTimer() {
    if (callBannerTimer) {
        clearInterval(callBannerTimer);
        callBannerTimer = null;
    }
}

function startCallBannerTimer() {
    stopCallBannerTimer();
    updateCallBanner();
    callBannerTimer = setInterval(() => {
        updateCallBanner();
    }, 1000);
}

function endCallSession(clearDetails = true) {
    stopRingtone();
    if (socket && socket.connected) {
        Object.keys(peerConnections).forEach(socketId => {
            socket.emit('end-call', { to: socketId });
        });
    }
    leaveVoiceChannel(true, true);
    if (clearDetails) {
        window.currentCallDetails = null;
    }
    callSessionActive = false;
    callStartTime = null;
    stopCallBannerTimer();
    updateCallBanner();
}

async function resumeCallSession() {
    if (!callSessionActive || !window.currentCallDetails?.friendId) {
        return;
    }
    if (inCall) {
        const callInterface = document.getElementById('callInterface');
        if (callInterface) callInterface.classList.remove('hidden');
        return;
    }
    
    try {
        const constraints = buildAudioConstraints();
        const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
        applyAudioProcessing(rawStream);
        localStream = await applyRnnoise(rawStream);
        
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        document.querySelector('.call-channel-name').textContent = `Call with ${window.currentCallDetails.friendName || 'Friend'}`;
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        localVideo.closest('.participant')?.classList.add('video-off');
        
        inCall = true;
        isVideoEnabled = false;
        isAudioEnabled = true;
        callStartTime = callStartTime || Date.now();
        hadPeerInCall = true;
        startCallBannerTimer();
        updateCallButtons();
        updateCallBanner();
        
        const peerSocketId = window.currentCallDetails.peerSocketId;
        if (peerSocketId) {
            const pc = createPeerConnection(peerSocketId, true);
            renegotiateConnection(peerSocketId, pc);
        }
    } catch (err) {
        console.error('Error resuming call session:', err);
        alert('РќРµ СѓРґР°Р»РѕСЃСЊ РІРµСЂРЅСѓС‚СЊСЃСЏ РІ Р·РІРѕРЅРѕРє. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·.');
    }
}

function getCallParticipantsList() {
    const names = [];
    if (currentUser?.username) names.push(currentUser.username);
    const peers = Object.keys(peerConnections);
    peers.forEach(socketId => {
        const name = getParticipantName(socketId);
        if (name && !names.includes(name)) {
            names.push(name);
        }
    });
    if (names.length === 1 && window.currentCallDetails?.friendName) {
        const fn = window.currentCallDetails.friendName;
        if (!names.includes(fn)) names.push(fn);
    }
    return names;
}

function updateCallBanner() {
    const banner = document.getElementById('callBanner');
    if (!banner) return;
    const isInDM = currentView === 'dm' && window.currentCallDetails?.friendId && currentDMUserId === window.currentCallDetails.friendId;
    const shouldShow = callSessionActive && isInDM;
    if (!shouldShow) {
        banner.classList.add('hidden');
        stopCallBannerTimer();
        return;
    }
    const titleEl = banner.querySelector('.call-banner-title');
    const participantsEl = banner.querySelector('.call-banner-participants');
    const timerEl = banner.querySelector('.call-banner-timer');
    const friendName = window.currentCallDetails.friendName || 'другом';
    const names = getCallParticipantsList();
    if (!callStartTime) {
        callStartTime = Date.now();
    }
    titleEl.textContent = `Звонок с ${friendName}`;
    participantsEl.textContent = `Участники: ${names.join(', ')}`;
    timerEl.textContent = `Длительность: ${formatCallDuration(Date.now() - callStartTime)}`;
    banner.classList.remove('hidden');
}
function initializeCallBannerControls() {
    const openBtn = document.getElementById('callBannerOpen');
    const endBtn = document.getElementById('callBannerEnd');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            resumeCallSession();
        });
    }
    if (endBtn) {
        endBtn.addEventListener('click', () => {
            endCallSession(true);
        });
    }
}

function openSettings(section = 'account') {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    settingsState.activeSection = section;
    applySettingsSection();
    modal.classList.remove('hidden');
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.add('hidden');
}

function applySettingsSection() {
    const items = document.querySelectorAll('.settings-item');
    items.forEach(btn => {
        const sec = btn.getAttribute('data-section');
        btn.classList.toggle('active', sec === settingsState.activeSection);
    });
    const titleEl = document.getElementById('settingsContentTitle');
    const bodyEl = document.getElementById('settingsContentBody');
    if (titleEl) {
        titleEl.textContent = sectionName(settingsState.activeSection);
    }
    if (bodyEl) {
        const tpl = settingsTemplates[settingsState.activeSection];
        bodyEl.innerHTML = typeof tpl === 'function' ? tpl() : `<p class="settings-placeholder">Р Р°Р·РґРµР» "${sectionName(settingsState.activeSection)}" СЃРєРѕСЂРѕ Р±СѓРґРµС‚ РґРѕСЃС‚СѓРїРµРЅ.</p>`;
    }
    wireSettingsContent();
}

function sectionName(key) {
    const map = {
        account: 'My Account',
        privacy: 'Content & Privacy',
        apps: 'Authorized Apps',
        devices: 'Devices',
        integrations: 'Integrations',
        nitro: 'Nitro',
        boosts: 'Server Boost',
        subscriptions: 'Subscriptions',
        billing: 'Billing',
        appearance: 'Appearance',
        voice: 'Voice & Video',
        notifications: 'Notifications'
    };
    return map[key] || 'Settings';
}

function initializeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    const closeBtn = document.getElementById('closeSettingsBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSettings);
    }
    const overlay = modal.querySelector('.settings-overlay');
    if (overlay) {
        overlay.addEventListener('click', closeSettings);
    }
    document.querySelectorAll('.settings-item').forEach(btn => {
        btn.addEventListener('click', () => {
            settingsState.activeSection = btn.getAttribute('data-section');
            applySettingsSection();
        });
    });
    const searchInput = document.getElementById('settingsSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('.settings-item').forEach(btn => {
                const label = btn.textContent.toLowerCase();
                btn.style.display = label.includes(q) ? 'block' : 'none';
            });
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeSettings();
        }
    });
}

function wireSettingsContent() {
    // Theme select
    const themeSelect = document.querySelector('.settings-select[data-setting="theme"]');
    if (themeSelect) {
        themeSelect.value = appSettings.theme;
        themeSelect.addEventListener('change', (e) => {
            setSetting('theme', e.target.value);
        });
    }
    // Font size
    const fontRange = document.querySelector('.settings-input[data-setting="fontSize"]');
    if (fontRange) {
        fontRange.value = appSettings.fontSize;
        fontRange.addEventListener('input', (e) => {
            const val = Math.min(20, Math.max(12, Number(e.target.value) || 16));
            setSetting('fontSize', val);
        });
    }
    // Notifications switch
    bindSwitch('notifications', 'notifications');
    bindSwitch('sounds', 'sounds');
    bindSwitch('rnnoise', 'rnnoise');
    bindSwitch('echoCancellation', 'echoCancellation');
    bindSwitch('browserNoiseSuppression', 'browserNoiseSuppression');
    bindSwitch('allowFriendRequests', 'allowFriendRequests');

    // Safe content select
    const safeSelect = document.querySelector('.settings-select[data-setting="safeContent"]');
    if (safeSelect) {
        safeSelect.value = appSettings.safeContent;
        safeSelect.addEventListener('change', (e) => setSetting('safeContent', e.target.value));
    }
    // Integrations buttons
    bindToggleButton('integration-github', 'integrations.github');
    bindToggleButton('integration-spotify', 'integrations.spotify');

    // Desktop notifications permission
    if (appSettings.notifications && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }

    // Log out from devices
    const logoutAllBtn = document.getElementById('logoutAllDevicesBtn');
    if (logoutAllBtn) {
        logoutAllBtn.addEventListener('click', () => {
            if (confirm('Log out from all devices?')) {
                localStorage.removeItem('token');
                localStorage.removeItem('currentUser');
                if (socket) socket.disconnect();
                window.location.replace('login.html');
            }
        });
    }

    document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            switch (action) {
                case 'change-password':
                    const newPass = prompt('Enter new password (demo only):');
                    if (newPass && newPass.length >= 4) {
                        setSetting('passwordLastChanged', Date.now());
                        alert('Password updated (demo).');
                        applySettingsSection();
                    } else if (newPass !== null) {
                        alert('Password too short.');
                    }
                    break;
                case 'open-nitro':
                    if (appSettings.nitroPlan) {
                        if (confirm('Cancel Nitro subscription?')) {
                            setSetting('nitroPlan', null);
                            alert('Nitro cancelled.');
                            applySettingsSection();
                        }
                    } else {
                        setSetting('nitroPlan', 'Nitro Basic');
                        appSettings.billingHistory.push(`Nitro Basic - ${new Date().toLocaleString()}`);
                        saveAppSettings();
                        alert('Nitro Basic activated (demo).');
                        applySettingsSection();
                    }
                    break;
                case 'open-boost':
                    setSetting('boosts', (appSettings.boosts || 0) + 1);
                    appSettings.billingHistory.push(`Server Boost - ${new Date().toLocaleString()}`);
                    saveAppSettings();
                    alert('Boost added (demo).');
                    applySettingsSection();
                    break;
                case 'add-payment':
                    const method = prompt('Enter payment label (demo):');
                    if (method) {
                        appSettings.billingMethods.push(method);
                        saveAppSettings();
                        alert('Payment method added.');
                        applySettingsSection();
                    }
                    break;
                case 'view-billing':
                    if (appSettings.billingHistory.length === 0) {
                        alert('No billing history.');
                    } else {
                        alert(appSettings.billingHistory.map((b, i) => `${i + 1}. ${b}`).join('\\n'));
                    }
                    break;
                default:
                    break;
            }
        });
    });

    const usernameForm = document.getElementById('usernameForm');
    if (usernameForm) {
        usernameForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('settingsUsername');
            if (!input) return;
            const newName = input.value.trim();
            if (newName.length < 3 || newName.length > 20) {
                alert('Username must be 3-20 characters');
                return;
            }
            await updateUsername(newName);
        });
    }

    const passwordForm = document.getElementById('passwordForm');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const current = document.getElementById('currentPassword')?.value;
            const next = document.getElementById('newPassword')?.value;
            if (!current || !next || next.length < 6) {
                alert('Fill all fields, new password min 6 chars');
                return;
            }
            await updatePassword(current, next);
        });
    }

    // Re-render switches initial state
    document.querySelectorAll('.settings-switch-checkbox').forEach(input => {
        const key = input.getAttribute('data-setting');
        if (!key) return;
        const val = getSettingValue(key);
        input.checked = !!val;
    });
}

function getSettingValue(path) {
    const parts = path.split('.');
    let obj = appSettings;
    for (const p of parts) {
        if (obj && typeof obj === 'object') {
            obj = obj[p];
        } else {
            return undefined;
        }
    }
    return obj;
}

function bindSwitch(selectorKey, settingKey) {
    const input = document.querySelector(`.settings-switch-checkbox[data-setting="${selectorKey}"]`);
    if (!input) return;
    input.checked = !!getSettingValue(settingKey);
    input.addEventListener('change', (e) => {
        setSetting(settingKey, e.target.checked);
        if (settingKey === 'notifications' && e.target.checked && 'Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    });
}

function bindToggleButton(btnId, settingKey) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const render = () => {
        const active = !!getSettingValue(settingKey);
        btn.textContent = active ? 'Disconnect' : 'Connect';
    };
    render();
    btn.addEventListener('click', () => {
        const current = !!getSettingValue(settingKey);
        setSetting(settingKey, !current);
        render();
    });
}

async function updateUsername(newName) {
    try {
        const res = await fetch('/api/user/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ username: newName })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || data.detail || 'Failed to update username');
            return;
        }
        currentUser.username = data.user.username;
        currentUser.avatar = data.user.avatar || data.user.username.charAt(0).toUpperCase();
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        updateUserInfo();
        applySettingsSection();
        alert('Username updated');
    } catch (err) {
        console.error('Username update error', err);
        alert('Failed to update username');
    }
}

async function updatePassword(currentPassword, newPassword) {
    try {
        const res = await fetch('/api/user/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || data.detail || 'Failed to update password');
            return;
        }
        setSetting('passwordLastChanged', Date.now());
        alert('Password updated');
        applySettingsSection();
    } catch (err) {
        console.error('Password update error', err);
        alert('Failed to update password');
    }
}

function removeParticipantUI(socketId) {
    const participantDiv = document.getElementById(`participant-${socketId}`);
    if (participantDiv) {
        participantDiv.remove();
    }
    const remoteVideo = document.getElementById(`remote-${socketId}`);
    if (remoteVideo) remoteVideo.remove();
}

function resetLonelyTimer() {
    if (lonelyCallTimeout) {
        clearTimeout(lonelyCallTimeout);
        lonelyCallTimeout = null;
    }
}

function scheduleLonelyHangup() {
    if (!inCall) return;
    if (!hadPeerInCall) return;
    if (Object.keys(peerConnections).length > 0) return;
    if (lonelyCallTimeout) return;
    lonelyCallTimeout = setTimeout(() => {
        lonelyCallTimeout = null;
        leaveVoiceChannel(true, true);
    }, 3 * 60 * 1000); // 3 minutes
}
// Initialize
document.addEventListener('DOMContentLoaded', () => {
    token = localStorage.getItem('token');
    const userStr = localStorage.getItem('currentUser');
    
    if (!token || !userStr) {
        window.location.replace('login.html');
        return;
    }
    
    try {
        currentUser = JSON.parse(userStr);
        initializeApp();
    } catch (e) {
        console.error('Error parsing user data:', e);
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        window.location.replace('login.html');
    }
});

function initializeApp() {
    updateUserInfo();
    loadAppSettings();
    initializeFriendsTabs();
    initializeChannels();
    initializeMessageInput();
    initializeUserControls();
    initializeCallControls();
    initializeDMCallButton();
    initializeCallBannerControls();
    initializeSettingsModal();
    initializeServerManagement();
    initializeFileUpload();
    initializeEmojiPicker();
    initializeDraggableCallWindow();
    connectToSocketIO();
    requestNotificationPermission();
    loadUserServers();
    loadGroups();
    showFriendsView();
}

function requestNotificationPermission() {
    if (appSettings.notifications === false) return;
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function ensureRingtone() {
    if (!ringtoneAudio) {
        ringtoneAudio = new Audio('Sounds/kasta-krestnaia-semia-nomerok_zgMllNp8.mp3');
        ringtoneAudio.loop = true;
        ringtoneAudio.preload = 'auto';
    }
    return ringtoneAudio;
}

function playRingtone() {
    try {
        const audio = ensureRingtone();
        audio.currentTime = 0;
        if (appSettings.sounds !== false) {
            audio.play().catch(() => {});
        }
    } catch (err) {
        console.error('Ringtone play error:', err);
    }
}

function stopRingtone() {
    if (ringtoneAudio) {
        ringtoneAudio.pause();
        ringtoneAudio.currentTime = 0;
    }
}

function playUserLeftSound() {
    if (appSettings.sounds === false) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 660;
        gain.gain.value = 0.12;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.22);
        osc.onended = () => ctx.close();
    } catch (err) {
        console.warn('Leave sound error:', err);
    }
}

function showNotification(title, body) {
    if (appSettings.notifications === false) return;
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/assets/icon.png' });
    }
}

const baseAudioProcessing = {
    get echoCancellation() {
        return appSettings.echoCancellation;
    },
    get noiseSuppression() {
        return appSettings.browserNoiseSuppression;
    },
    autoGainControl: true
};

function buildAudioConstraints(extra = {}) {
    return {
        audio: {
            ...baseAudioProcessing,
            ...extra
        }
    };
}

function applyAudioProcessing(stream) {
    if (!stream) return;
    stream.getAudioTracks().forEach(track => {
        track.applyConstraints(baseAudioProcessing).catch(err => {
            console.warn('Could not apply audio processing constraints:', err);
        });
    });
}

async function ensureRnnoiseReady() {
    if (appSettings.rnnoise === false) return null;
    if (rnnoiseReadyPromise) return rnnoiseReadyPromise;
    rnnoiseReadyPromise = (async () => {
        const module = await import('/node_modules/simple-rnnoise-wasm/dist/rnnoise.mjs');
        rnnoiseModule = module;
        if (!rnnoiseAudioContext) {
            rnnoiseAudioContext = new AudioContext({ sampleRate: 48000 });
        }
        if (rnnoiseAudioContext.state === 'suspended') {
            await rnnoiseAudioContext.resume();
        }
        const assets = await module.rnnoise_loadAssets({
            scriptSrc: '/node_modules/simple-rnnoise-wasm/dist/rnnoise.worklet.js',
            moduleSrc: '/node_modules/simple-rnnoise-wasm/dist/rnnoise.wasm'
        });
        await module.RNNoiseNode.register(rnnoiseAudioContext, assets);
        return module;
    })().catch(err => {
        rnnoiseReadyPromise = null;
        throw err;
    });
    return rnnoiseReadyPromise;
}

async function applyRnnoise(stream) {
    if (!stream || stream.getAudioTracks().length === 0) return stream;
    if (appSettings.rnnoise === false) return stream;
    rawAudioStream = stream;
    try {
        const module = await ensureRnnoiseReady();
        if (rnnoiseAudioContext.state === 'suspended') {
            await rnnoiseAudioContext.resume();
        }
        // Clean up previous processing graph if it exists
        cleanupRnnoiseGraph(false);
        
        rnnoiseSourceNode = rnnoiseAudioContext.createMediaStreamSource(stream);
        rnnoiseNode = new module.RNNoiseNode(rnnoiseAudioContext);
        rnnoiseDestination = rnnoiseAudioContext.createMediaStreamDestination();
        
        rnnoiseSourceNode.connect(rnnoiseNode).connect(rnnoiseDestination);
        processedAudioStream = rnnoiseDestination.stream;
        const processedTrack = processedAudioStream.getAudioTracks()[0];
        const newStream = new MediaStream();
        if (processedTrack) newStream.addTrack(processedTrack);
        stream.getVideoTracks().forEach(track => newStream.addTrack(track));
        return newStream;
    } catch (err) {
        console.error('RNNoise initialization failed, falling back to raw audio:', err);
        return stream;
    }
}

function cleanupRnnoiseGraph(stopRaw = true) {
    try {
        if (rnnoiseSourceNode) rnnoiseSourceNode.disconnect();
        if (rnnoiseNode) rnnoiseNode.disconnect();
        if (rnnoiseDestination) rnnoiseDestination.disconnect();
    } catch (e) {
        console.warn('RNNoise cleanup warning:', e);
    }
    rnnoiseSourceNode = null;
    rnnoiseNode = null;
    rnnoiseDestination = null;
    
    if (processedAudioStream) {
        processedAudioStream.getTracks().forEach(track => track.stop());
        processedAudioStream = null;
    }
    if (stopRaw && rawAudioStream) {
        rawAudioStream.getTracks().forEach(track => track.stop());
        rawAudioStream = null;
    }
}

function ensureRemoteAudioContext() {
    if (!remoteAudioContext) {
        remoteAudioContext = new AudioContext({ sampleRate: 48000 });
    }
    if (remoteAudioContext.state === 'suspended') {
        remoteAudioContext.resume().catch(() => {});
    }
    return remoteAudioContext;
}

function setParticipantVolume(socketId, volume) {
    const clamped = Math.max(0, Math.min(2, volume));
    participantVolumes[socketId] = clamped;
    const graph = remoteAudioGraphs[socketId];
    if (graph?.gain) {
        graph.gain.gain.value = clamped;
    }
    const video = document.getElementById(`remote-${socketId}`);
    if (video) {
        video.volume = Math.min(1, clamped);
    }
}

function attachRemoteAudio(socketId, stream) {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const ctx = ensureRemoteAudioContext();
    const existing = remoteAudioGraphs[socketId];
    try {
        if (existing) {
            existing.source.disconnect();
            existing.gain.disconnect();
        }
    } catch (e) {
        console.warn('Error cleaning old remote audio graph:', e);
    }
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    const initialVol = participantVolumes[socketId] ?? 1;
    gain.gain.value = initialVol;
    source.connect(gain).connect(ctx.destination);
    remoteAudioGraphs[socketId] = { source, gain };
    setParticipantVolume(socketId, initialVol);
}

function cleanupParticipantAudio(socketId) {
    const graph = remoteAudioGraphs[socketId];
    if (graph) {
        try {
            graph.source.disconnect();
            graph.gain.disconnect();
        } catch (e) {
            console.warn('Remote audio cleanup warning:', e);
        }
    }
    delete remoteAudioGraphs[socketId];
    delete participantVolumes[socketId];
}

function cleanupAllRemoteAudio() {
    Object.keys(remoteAudioGraphs).forEach(socketId => cleanupParticipantAudio(socketId));
    remoteAudioGraphs = {};
    participantVolumes = {};
    if (remoteAudioContext) {
        remoteAudioContext.close().catch(() => {});
        remoteAudioContext = null;
    }
}

function hideAllVolumeMenus() {
    document.querySelectorAll('.volume-menu').forEach(m => m.classList.add('hidden'));
}

function attachVolumeMenu(participantDiv, socketId) {
    if (!participantDiv || participantDiv.querySelector('.volume-menu')) return;
    const initial = Math.round((participantVolumes[socketId] ?? 1) * 100);
    const menu = document.createElement('div');
    menu.className = 'volume-menu hidden';
    menu.innerHTML = `
        <div class="volume-menu-row">
            <span>Volume</span>
            <span class="volume-value">${initial}%</span>
        </div>
        <input type="range" class="volume-slider" min="0" max="200" value="${initial}">
        <div class="volume-hint">Right-click or Alt+Click to toggle</div>
    `;
    participantDiv.appendChild(menu);
    
    const valueEl = menu.querySelector('.volume-value');
    const slider = menu.querySelector('.volume-slider');
    slider.addEventListener('input', (e) => {
        const vol = Number(e.target.value) / 100;
        valueEl.textContent = `${e.target.value}%`;
        setParticipantVolume(socketId, vol);
    });
    
    const toggleMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideAllVolumeMenus();
        menu.classList.toggle('hidden');
    };
    
    participantDiv.addEventListener('contextmenu', toggleMenu);
    participantDiv.addEventListener('click', (e) => {
        if (e.target.closest('.volume-menu')) return;
        if (e.altKey) {
            toggleMenu(e);
        }
    });
    
    if (!volumeMenuGlobalListenerAttached) {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.volume-menu') && !e.target.closest('.participant')) {
                hideAllVolumeMenus();
            }
        });
        volumeMenuGlobalListenerAttached = true;
    }
}

function updateUserInfo() {
    const userAvatar = document.querySelector('.user-avatar');
    const username = document.querySelector('.username');
    const localAvatar = document.getElementById('localAvatar');
    
    if (userAvatar) userAvatar.textContent = currentUser.avatar;
    if (username) username.textContent = currentUser.username;
    if (localAvatar) localAvatar.textContent = currentUser.avatar || currentUser.username?.charAt(0).toUpperCase() || 'U';
}

function connectToSocketIO() {
    if (typeof io !== 'undefined') {
        socket = io({ auth: { token: token } });
        
        socket.on('connect', () => {
            console.log('Connected to server');
        });
        
       socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
        });
        
        socket.on('new-message', (data) => {
            const channelId = data.channelId;
            const channelName = getChannelNameById(channelId);

            if (!channels[channelName]) {
                channels[channelName] = [];
            }
            channels[channelName].push(data.message);
            
            if (channelName === currentChannel && currentView === 'server') {
                addMessageToUI(data.message);
                scrollToBottom();
            }
            
            if (document.hidden) {
                showNotification('New Message', `${data.message.author}: ${data.message.text}`);
            }
        });
        
        socket.on('reaction-update', (data) => {
            updateMessageReactions(data.messageId, data.reactions);
        });

        // WebRTC Signaling
        socket.on('user-joined-voice', (data) => {
            console.log('User joined voice:', data);
            if (data?.socketId) {
                rememberParticipant(data.socketId, data.username || data.userId, data.avatar);
            }
            createPeerConnection(data.socketId, true);
        });

        socket.on('existing-voice-users', (users) => {
            users.forEach(user => {
                if (user?.socketId) {
                    rememberParticipant(user.socketId, user.username, user.avatar);
                    createPeerConnection(user.socketId, false);
                }
            });
        });

        socket.on('user-left-voice', (socketId) => {
            if (peerConnections[socketId]) {
                peerConnections[socketId].close();
                delete peerConnections[socketId];
            }
            forgetParticipant(socketId);
            cleanupParticipantAudio(socketId);
            removeParticipantUI(socketId);
            playUserLeftSound();
            scheduleLonelyHangup();
            updateCallBanner();
        });

        socket.on('offer', async (data) => {
            if (!peerConnections[data.from]) {
                createPeerConnection(data.from, false);
            }
            const pc = peerConnections[data.from];
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', { to: data.from, answer: answer });
        });

        socket.on('answer', async (data) => {
            const pc = peerConnections[data.from];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        });

        socket.on('ice-candidate', async (data) => {
            const pc = peerConnections[data.from];
            if (pc && data.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });
        
        socket.on('video-toggle', (data) => {
            // Update UI when peer toggles video
            const participantDiv = document.getElementById(`participant-${data.from}`);
            if (participantDiv) {
                if (data.enabled) {
                    participantDiv.classList.remove('video-off');
                    participantDiv.style.opacity = '1';
                } else {
                    participantDiv.classList.add('video-off');
                    participantDiv.style.opacity = '0.7';
                }
            }
        });
        socket.on('new-dm', (data) => {
            if (data.senderId === currentDMUserId) {
                addMessageToUI({
                    id: data.message.id,
                    author: data.message.author,
                    avatar: data.message.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('dm-sent', (data) => {
            if (data.receiverId === currentDMUserId) {
                addMessageToUI({
                    id: data.message.id,
                    author: currentUser.username,
                    avatar: currentUser.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('new-friend-request', () => {
            loadPendingRequests();
            showNotification('New Friend Request', 'You have a new friend request!');
        });

        socket.on('group-message', (data) => {
            if (data.groupId === currentGroupId) {
                addMessageToUI({
                    id: data.id,
                    author: data.author,
                    avatar: data.avatar,
                    text: data.text,
                    timestamp: data.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('user-renamed', (data) => {
            if (!data || !data.id) return;
            if (currentUser && data.id === currentUser.id) {
                currentUser.username = data.username;
                currentUser.avatar = data.avatar;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                updateUserInfo();
            }
            if (currentDMUserId && data.id === currentDMUserId) {
                currentDMUsername = data.username;
                const chatHeaderInfo = document.getElementById('chatHeaderInfo');
                if (chatHeaderInfo) {
                    chatHeaderInfo.innerHTML = `
                        <div class="friend-avatar">${data.avatar}</div>
                        <span class="channel-name">${data.username}</span>
                    `;
                }
                if (window.currentCallDetails) {
                    window.currentCallDetails.friendName = data.username;
                    window.currentCallDetails.peerName = data.username;
                }
                updateCallBanner();
            }
            loadFriends(); // refresh lists to reflect new name
        });

        socket.on('incoming-call', (data) => {
            const { from, type } = data;
            if (from) {
                rememberParticipant(from.socketId, from.username, from.avatar);
                showIncomingCall(from, type);
            }
        });

        socket.on('call-accepted', (data) => {
            console.log('Call accepted by:', data.from);
            stopRingtone();
            // When call is accepted, create peer connection
            document.querySelector('.call-channel-name').textContent = `Connected with ${data.from.username}`;
            rememberParticipant(data.from.socketId, data.from.username, data.from.avatar);
            if (window.currentCallDetails) {
                window.currentCallDetails.peerSocketId = data.from.socketId;
                window.currentCallDetails.peerName = data.from.username;
                window.currentCallDetails.peerAvatar = data.from.avatar;
            }
            if (!callStartTime) callStartTime = Date.now();
            hadPeerInCall = true;
            callSessionActive = true;
            startCallBannerTimer();
            updateCallBanner();
            
            // Create peer connection as initiator
            if (!peerConnections[data.from.socketId]) {
                createPeerConnection(data.from.socketId, true);
            }
        });

        socket.on('call-rejected', (data) => {
            alert('Call was declined');
            stopRingtone();
            // Close call interface
            const callInterface = document.getElementById('callInterface');
            callInterface.classList.add('hidden');
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            cleanupRnnoiseGraph(true);
            if (rnnoiseAudioContext) {
                rnnoiseAudioContext.close().catch(() => {});
                rnnoiseAudioContext = null;
                rnnoiseReadyPromise = null;
                rnnoiseModule = null;
            }
            cleanupAllRemoteAudio();
            participantNames = {};
            participantAvatars = {};
            window.currentCallDetails = null;
            callSessionActive = false;
            callStartTime = null;
            stopCallBannerTimer();
            inCall = false;
            updateCallBanner();
        });
        
        socket.on('call-ended', (data) => {
            // Handle when other party ends the call
            stopRingtone();
            if (peerConnections[data.from]) {
                peerConnections[data.from].close();
                delete peerConnections[data.from];
            }
            forgetParticipant(data.from);
            cleanupParticipantAudio(data.from);
            removeParticipantUI(data.from);
            playUserLeftSound();
            
            scheduleLonelyHangup();
            if (Object.keys(peerConnections).length === 0) {
                callSessionActive = false;
                callStartTime = null;
                stopCallBannerTimer();
            }
            updateCallBanner();
        });
    }
}

// Initialize friends tabs
function initializeFriendsTabs() {
    const tabs = document.querySelectorAll('.friends-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            switchFriendsTab(tabName);
        });
    });
    
    const searchBtn = document.getElementById('searchUserBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', searchUsers);
    }
    
    loadFriends();
    const createGroupBtn = document.getElementById('createGroupBtn');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', () => {
            createGroup();
        });
    }
}

function switchFriendsTab(tabName) {
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    document.querySelectorAll('.friends-list').forEach(l => l.classList.remove('active-tab'));
    const contentMap = {
        'online': 'friendsOnline',
        'all': 'friendsAll',
        'pending': 'friendsPending',
        'add': 'friendsAdd'
    };
    document.getElementById(contentMap[tabName]).classList.add('active-tab');
    
    if (tabName === 'pending') {
        loadPendingRequests();
    }
}

async function loadFriends() {
    try {
        const response = await fetch('/api/friends', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const friends = await response.json();
        displayFriends(friends);
        populateDMList(friends);
    } catch (error) {
        console.error('Error loading friends:', error);
    }
}

function displayFriends(friends) {
    const onlineList = document.getElementById('friendsOnline');
    const allList = document.getElementById('friendsAll');
    
    onlineList.innerHTML = '';
    allList.innerHTML = '';
    
    if (friends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">No friends yet</div>';
        allList.innerHTML = '<div class="friends-empty">No friends yet</div>';
        return;
    }
    
    const onlineFriends = friends.filter(f => f.status === 'Online');
    
    if (onlineFriends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">No one is online</div>';
    } else {
        onlineFriends.forEach(friend => {
            onlineList.appendChild(createFriendItem(friend));
        });
    }
    
    friends.forEach(friend => {
        allList.appendChild(createFriendItem(friend));
    });
}

function createFriendItem(friend) {
    const div = document.createElement('div');
    div.className = 'friend-item';
    
    div.innerHTML = `
        <div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>
        <div class="friend-info">
            <div class="friend-name">${friend.username}</div>
            <div class="friend-status ${friend.status === 'Online' ? '' : 'offline'}">${friend.status}</div>
        </div>
        <div class="friend-actions">
            <button class="friend-action-btn message" title="Message">рџ’¬</button>
            <button class="friend-action-btn audio-call" title="Audio Call">рџ“ћ</button>
            <button class="friend-action-btn video-call" title="Video Call">рџ“№</button>
            <button class="friend-action-btn remove" title="Remove">рџ—‘пёЏ</button>
        </div>
    `;

    div.querySelector('.message').addEventListener('click', () => startDM(friend.id, friend.username));
    div.querySelector('.audio-call').addEventListener('click', () => initiateCall(friend.id, 'audio', friend.username));
    div.querySelector('.video-call').addEventListener('click', () => initiateCall(friend.id, 'video', friend.username));
    div.querySelector('.remove').addEventListener('click', () => removeFriend(friend.id));
    
    return div;
}

async function searchUsers() {
    const searchInput = document.getElementById('searchUserInput');
    const query = searchInput.value.trim();
    
    if (!query) return;
    
    try {
        const response = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await response.json();
        
        const results = users.filter(u => 
            u.username.toLowerCase().includes(query.toLowerCase()) && 
            u.id !== currentUser.id
        );
        
        displaySearchResults(results);
    } catch (error) {
        console.error('Error searching users:', error);
    }
}

function displaySearchResults(users) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';
    
    if (users.length === 0) {
        resultsDiv.innerHTML = '<div class="friends-empty">No users found</div>';
        return;
    }
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-search-item';
        
        div.innerHTML = `
            <div class="user-avatar">${user.avatar || user.username.charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">${user.username}</div>
            </div>
            <button class="add-friend-btn" onclick="sendFriendRequest(${user.id})">Add Friend</button>
        `;
        
        resultsDiv.appendChild(div);
    });
}

window.sendFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            alert('Friend request sent!');
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to send request');
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        alert('Failed to send friend request');
    }
};

async function loadPendingRequests() {
    try {
        const response = await fetch('/api/friends/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const requests = await response.json();
        
        const pendingList = document.getElementById('friendsPending');
        pendingList.innerHTML = '';
        
        if (requests.length === 0) {
            pendingList.innerHTML = '<div class="friends-empty">No pending requests</div>';
            return;
        }
        
        requests.forEach(request => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            
            div.innerHTML = `
                <div class="friend-avatar">${request.avatar || request.username.charAt(0).toUpperCase()}</div>
                <div class="friend-info">
                    <div class="friend-name">${request.username}</div>
                    <div class="friend-status">Incoming Friend Request</div>
                </div>
                <div class="friend-actions">
                    <button class="friend-action-btn accept" onclick="acceptFriendRequest(${request.id})">вњ“</button>
                    <button class="friend-action-btn reject" onclick="rejectFriendRequest(${request.id})">вњ•</button>
                </div>
            `;
            
            pendingList.appendChild(div);
        });
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

window.acceptFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/accept', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            loadPendingRequests();
            loadFriends();
        }
    } catch (error) {
        console.error('Error accepting friend request:', error);
    }
};

window.rejectFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/reject', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            loadPendingRequests();
        }
    } catch (error) {
        console.error('Error rejecting friend request:', error);
    }
};

window.removeFriend = async function(friendId) {
    if (!confirm('Are you sure you want to remove this friend?')) return;
    
    try {
        const response = await fetch(`/api/friends/${friendId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            loadFriends();
        }
    } catch (error) {
        console.error('Error removing friend:', error);
    }
};

// Initiate call function
async function initiateCall(friendId, type, friendName = '') {
    try {
        // Request only audio; ask for camera later when user toggles video
        const constraints = buildAudioConstraints();
        const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
        applyAudioProcessing(rawStream);
        localStream = await applyRnnoise(rawStream);
        
        // Show call interface
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        
        // Update call header
        document.querySelector('.call-channel-name').textContent = friendName ? `Calling ${friendName}...` : `Calling...`;
        playRingtone();
        
        // Set local video
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // Store call details
        window.currentCallDetails = {
            friendId: friendId,
            friendName: friendName,
            friendAvatar: null,
            type: type,
            isInitiator: true,
            originalType: type
        };
        callStartTime = callStartTime || Date.now();
        callSessionActive = true;
        startCallBannerTimer();
        
        // Emit call request via socket
        if (socket && socket.connected) {
            socket.emit('initiate-call', {
                to: friendId,
                type: type,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id,
                    avatar: currentUser.avatar
                }
            });
        }
        
        inCall = true;
        isVideoEnabled = false; // Video turns on only after user clicks the button
        isAudioEnabled = true;
        updateCallButtons();
        
        // Initialize resizable functionality after a short delay
        setTimeout(() => {
            if (typeof initializeResizableVideos === 'function') {
                initializeResizableVideos();
            }
        }, 100);
        
    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Failed to access camera/microphone. Please check permissions.');
    }
}

// Show incoming call notification
function showIncomingCall(caller, type) {
    const incomingCallDiv = document.getElementById('incomingCall');
    const callerName = incomingCallDiv.querySelector('.caller-name');
    const callerAvatar = incomingCallDiv.querySelector('.caller-avatar');
    
        callerName.textContent = caller.username || 'Unknown User';
        callerAvatar.textContent = caller.avatar || caller.username?.charAt(0).toUpperCase() || 'U';
        
        incomingCallDiv.classList.remove('hidden');
        playRingtone();
    
    // Set up accept/reject handlers
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    
    acceptBtn.onclick = async () => {
        incomingCallDiv.classList.add('hidden');
        await acceptCall(caller, type);
    };
    
    rejectBtn.onclick = () => {
        incomingCallDiv.classList.add('hidden');
        rejectCall(caller);
    };
    
    // Auto-reject after 30 seconds
    setTimeout(() => {
        if (!incomingCallDiv.classList.contains('hidden')) {
            incomingCallDiv.classList.add('hidden');
            rejectCall(caller);
        }
    }, 30000);
}

// Accept incoming call
async function acceptCall(caller, type) {
    try {
        // Request only audio; ask for camera later when video is enabled
        const constraints = buildAudioConstraints();
        const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
        applyAudioProcessing(rawStream);
        localStream = await applyRnnoise(rawStream);
        stopRingtone();
        
        // Show call interface
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        
        document.querySelector('.call-channel-name').textContent = `Call with ${caller.username}`;
        rememberParticipant(caller.socketId, caller.username, caller.avatar);
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // Store call details
        window.currentCallDetails = {
            friendId: caller.id,
            peerId: caller.socketId,
            peerSocketId: caller.socketId,
            peerName: caller.username,
            peerAvatar: caller.avatar,
            friendName: caller.username,
            friendAvatar: caller.avatar,
            type: type,
            isInitiator: false,
            originalType: type
        };
        
        if (socket && socket.connected) {
            socket.emit('accept-call', {
                to: caller.socketId,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id,
                    avatar: currentUser.avatar
                }
            });
        }
        
        inCall = true;
        isVideoEnabled = false; // Video is enabled only after a click
        isAudioEnabled = true;
        callStartTime = Date.now();
        callSessionActive = true;
        startCallBannerTimer();
        updateCallButtons();
        updateCallBanner();
        
        // Create peer connection as receiver (not initiator)
        if (!peerConnections[caller.socketId]) {
            createPeerConnection(caller.socketId, false);
        }
        
        // Initialize resizable functionality after a short delay
        setTimeout(() => {
            if (typeof initializeResizableVideos === 'function') {
                initializeResizableVideos();
            }
        }, 100);
        
    } catch (error) {
        console.error('Error accepting call:', error);
        alert('Failed to access camera/microphone. Please check permissions.');
    }
}

// Reject incoming call
function rejectCall(caller) {
    if (socket && socket.connected) {
        socket.emit('reject-call', { to: caller.socketId });
    }
    stopRingtone();
}

window.startDM = async function(friendId, friendUsername) {
    currentView = 'dm';
    currentDMUserId = friendId;
    currentDMUsername = friendUsername;
    currentServerId = null;
    currentGroupId = null;
    currentGroupName = null;
    currentGroupOwnerId = null;
    toggleGroupPanel(false);

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

        const chatHeaderInfo = document.getElementById('chatHeaderInfo');
        chatHeaderInfo.innerHTML = `
            <div class="friend-avatar">${friendUsername.charAt(0).toUpperCase()}</div>
            <span class="channel-name">${friendUsername}</span>
        `;
    
    document.getElementById('messageInput').placeholder = `Message @${friendUsername}`;
    
    const callBtn = document.getElementById('callFriendBtn');
    if (callBtn) callBtn.style.display = 'inline-flex';
    updateCallBanner();
    
    await loadDMHistory(friendId);
};

// Show friends view
function showFriendsView() {
    currentView = 'friends';
    currentDMUserId = null;
    currentDMUsername = null;
    currentServerId = null;
    currentGroupId = null;
    currentGroupName = null;
    currentGroupOwnerId = null;
    toggleGroupPanel(false);

    document.getElementById('friendsView').style.display = 'flex';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';
    
    document.getElementById('serverName').textContent = 'Friends';
    
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    document.getElementById('friendsBtn').classList.add('active');
    
    // Hide chat and show friends content
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('friendsView').style.display = 'flex';
    const callBtn = document.getElementById('callFriendBtn');
    if (callBtn) callBtn.style.display = 'none';
    updateCallBanner();
}

// Show server view
function showServerView(server) {
    currentView = 'server';
    currentServerId = server.id;
    currentDMUserId = null;
    currentDMUsername = null;
    currentGroupId = null;
    currentGroupName = null;
    currentGroupOwnerId = null;
    toggleGroupPanel(false);

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'block';
    document.getElementById('dmListView').style.display = 'none';

    document.getElementById('serverName').textContent = server.name;
    switchChannel('general');
    const callBtn = document.getElementById('callFriendBtn');
    if (callBtn) callBtn.style.display = 'none';
    updateCallBanner();
}

async function openGroupChat(group) {
    currentView = 'group';
    currentGroupId = group.id;
    currentGroupName = group.name;
    currentGroupOwnerId = group.owner_id || group.ownerId;
    currentDMUserId = null;
    currentDMUsername = null;
    currentServerId = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    chatHeaderInfo.innerHTML = `
        <div class="friend-avatar">${group.name.charAt(0).toUpperCase()}</div>
        <span class="channel-name">${group.name}</span>
    `;
    document.getElementById('messageInput').placeholder = `Message ${group.name}`;

    const callBtn = document.getElementById('callFriendBtn');
    if (callBtn) callBtn.style.display = 'none';
    renderGroupActions();
    await loadGroupMembers(group.id);
    toggleGroupPanel(true);
    updateCallBanner();

    await loadGroupHistory(group.id);
}

async function loadUserServers() {
    try {
        const response = await fetch('/api/servers', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        servers = await response.json();
        servers.forEach(server => addServerToUI(server, false));
    } catch (error) {
        console.error('Error loading servers:', error);
    }
}

async function loadGroups() {
    try {
        const res = await fetch('/api/groups', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const groups = await res.json();
            renderGroupList(groups);
        }
    } catch (err) {
        console.error('Error loading groups:', err);
    }
}

function renderGroupList(groups) {
    const list = document.getElementById('groupList');
    if (!list) return;
    list.innerHTML = '';
    if (!groups || groups.length === 0) {
        list.innerHTML = '<div class="friends-empty">No groups</div>';
        return;
    }
    groups.forEach(g => {
        const item = document.createElement('div');
        item.className = 'channel dm-item';
        item.innerHTML = `
            <div class="friend-avatar">${g.name.charAt(0).toUpperCase()}</div>
            <span>${g.name}</span>
        `;
        item.addEventListener('click', () => openGroupChat(g));
        list.appendChild(item);
    });
}

function initializeServerManagement() {
    const friendsBtn = document.getElementById('friendsBtn');
    const addServerBtn = document.getElementById('addServerBtn');
    
    friendsBtn.addEventListener('click', () => {
        showFriendsView();
    });
    
    addServerBtn.addEventListener('click', () => {
        createNewServer();
    });
}

function renderGroupActions() {
    const controls = document.querySelector('.chat-controls');
    if (!controls) return;
    const existing = controls.querySelector('.group-actions');
    if (existing) existing.remove();
    if (currentView !== 'group' || !currentGroupId) return;

    const container = document.createElement('div');
    container.className = 'group-actions';

    if (currentGroupOwnerId === currentUser?.id) {
        const addBtn = document.createElement('button');
        addBtn.className = 'small-btn';
        addBtn.textContent = 'Add';
        addBtn.addEventListener('click', addGroupMemberPrompt);
        container.appendChild(addBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'small-btn danger-btn';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', deleteGroup);
        container.appendChild(delBtn);
    } else {
        const leaveBtn = document.createElement('button');
        leaveBtn.className = 'small-btn danger-btn';
        leaveBtn.textContent = 'Leave';
        leaveBtn.addEventListener('click', leaveGroup);
        container.appendChild(leaveBtn);
    }

    controls.appendChild(container);
}

async function createGroup() {
    const name = prompt('Enter group name:');
    if (!name || name.trim().length < 3) return;
    const members = [];
    if (currentView === 'dm' && currentDMUserId) {
        members.push(currentDMUserId);
    }
    try {
        const res = await fetch('/api/groups', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name: name.trim(), memberIds: members })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Failed to create group');
            return;
        }
        loadGroups();
        if (data.group) {
            openGroupChat({ id: data.group.id, name: data.group.name, owner_id: currentUser.id });
        }
    } catch (err) {
        console.error('Create group error:', err);
        alert('Failed to create group');
    }
}

async function addGroupMemberPrompt() {
    if (!currentGroupId || currentGroupOwnerId !== currentUser?.id) return;
    try {
        const res = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await res.json();
        const name = prompt('Enter username to add:');
        if (!name) return;
        const target = users.find(u => u.username.toLowerCase() === name.toLowerCase());
        if (!target) {
            alert('User not found');
            return;
        }
        const addRes = await fetch(`/api/groups/${currentGroupId}/members`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ userId: target.id })
        });
        const data = await addRes.json();
        if (!addRes.ok) {
            alert(data.error || 'Failed to add member');
            return;
        }
        alert('Member added');
        loadGroupMembers(currentGroupId);
    } catch (err) {
        console.error('Add member error:', err);
        alert('Failed to add member');
    }
}

async function deleteGroup() {
    if (!currentGroupId || currentGroupOwnerId !== currentUser?.id) return;
    if (!confirm('Delete this group?')) return;
    try {
        const res = await fetch(`/api/groups/${currentGroupId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Failed to delete group');
            return;
        }
        currentGroupId = null;
        currentGroupName = null;
        currentGroupOwnerId = null;
        document.getElementById('messagesContainer').innerHTML = '';
        loadGroups();
        showFriendsView();
    } catch (err) {
        console.error('Delete group error:', err);
        alert('Failed to delete group');
    }
}

async function leaveGroup() {
    if (!currentGroupId) return;
    try {
        const res = await fetch(`/api/groups/${currentGroupId}/members/${currentUser.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Failed to leave group');
            return;
        }
        currentGroupId = null;
        currentGroupName = null;
        currentGroupOwnerId = null;
        document.getElementById('messagesContainer').innerHTML = '';
        loadGroups();
        showFriendsView();
    } catch (err) {
        console.error('Leave group error:', err);
        alert('Failed to leave group');
    }
}

async function createNewServer() {
    const serverName = prompt('Enter server name:');
    
    if (!serverName || serverName.trim() === '') return;
    
    try {
        const response = await fetch('/api/servers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: serverName.trim() })
        });
        
        if (response.ok) {
            const server = await response.json();
            servers.push(server);
            addServerToUI(server, true);
        }
    } catch (error) {
        console.error('Error creating server:', error);
        alert('Failed to create server');
    }
}

function addServerToUI(server, switchTo = false) {
    const serverList = document.querySelector('.server-list');
    const addServerBtn = document.getElementById('addServerBtn');
    
    const serverIcon = document.createElement('div');
    serverIcon.className = 'server-icon';
    serverIcon.textContent = server.icon;
    serverIcon.title = server.name;
    serverIcon.setAttribute('data-server-id', server.id);
    
    serverIcon.addEventListener('click', () => {
        document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
        serverIcon.classList.add('active');
        showServerView(server);
    });
    
    serverList.insertBefore(serverIcon, addServerBtn);
    
    if (switchTo) {
        serverIcon.click();
    }
}

function initializeChannels() {
    const channelElements = document.querySelectorAll('.channel');
    
    channelElements.forEach(channel => {
        channel.addEventListener('click', () => {
            const channelName = channel.getAttribute('data-channel');
            const isVoiceChannel = channel.classList.contains('voice-channel');
            
            if (isVoiceChannel) {
                joinVoiceChannel(channelName);
            } else {
                switchChannel(channelName);
            }
        });
    });
}

function switchChannel(channelName) {
    currentChannel = channelName;
    
    document.querySelectorAll('.text-channel').forEach(ch => ch.classList.remove('active'));
    const channelEl = document.querySelector(`[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('active');
    
    document.getElementById('currentChannelName').textContent = channelName;
    document.getElementById('messageInput').placeholder = `Message #${channelName}`;
    
    loadChannelMessages(channelName);
}

async function loadChannelMessages(channelName) {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.innerHTML = '';
    lastMessageDayKey = null;
    lastMessageAuthor = null;
    lastMessageTimestamp = 0;

    // For now, we'll use a hardcoded channel ID. This needs to be improved.
    const channelId = channelName === 'general' ? 1 : 2;

    try {
        const response = await fetch(`/api/messages/${channelId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const messages = await response.json();
            messages.forEach(message => {
                addMessageToUI({
                    id: message.id,
                    author: message.username,
                    avatar: message.avatar || message.username.charAt(0).toUpperCase(),
                    text: message.content,
                    timestamp: message.created_at
                });
            });
        } else {
            console.error('Failed to load messages');
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }

    scrollToBottom();
}

function initializeMessageInput() {
    const messageInput = document.getElementById('messageInput');
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const text = messageInput.value.trim();
    
    if (text === '') return;

    const message = {
        text: text,
    };

    if (socket && socket.connected) {
        if (currentView === 'dm' && currentDMUserId) {
            socket.emit('send-dm', {
                receiverId: currentDMUserId,
                message: message
            });
        } else if (currentView === 'group' && currentGroupId) {
            socket.emit('send-group-message', {
                groupId: currentGroupId,
                message: message
            });
        } else if (currentView === 'server') {
            const channelId = getChannelIdByName(currentChannel);
            socket.emit('send-message', {
                channelId: channelId,
                message: message
            });
        }
    }
    
    messageInput.value = '';
}

function addMessageToUI(message) {
    const messagesContainer = document.getElementById('messagesContainer');
    const dayKey = formatDayKey(message.timestamp);
    if (dayKey !== lastMessageDayKey) {
        const divider = document.createElement('div');
        divider.className = 'message-day-divider';
        divider.textContent = formatDayLabel(message.timestamp);
        messagesContainer.appendChild(divider);
        lastMessageDayKey = dayKey;
    }

    const isOwn = currentUser && message.author === currentUser.username;
    const msgTime = new Date(message.timestamp).getTime();
    const showHeader = message.author !== lastMessageAuthor || (msgTime - lastMessageTimestamp) > 5 * 60 * 1000;

    const row = document.createElement('div');
    row.className = `message-row ${isOwn ? 'own' : 'remote'} ${showHeader ? '' : 'continued'}`;
    row.setAttribute('data-message-id', message.id || Date.now());

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = message.avatar;
    if (!showHeader) {
        avatar.classList.add('hidden-avatar');
    }

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'message-bubble';

    if (showHeader) {
        const meta = document.createElement('div');
        meta.className = 'message-meta';

        const author = document.createElement('span');
        author.className = 'message-author';
        author.textContent = message.author;

        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = formatTimeLabel(message.timestamp);

        meta.appendChild(author);
        meta.appendChild(time);
        bodyWrap.appendChild(meta);
    }

    const body = document.createElement('div');
    body.className = 'message-body';
    body.innerHTML = escapeHtml(message.text || '').replace(/\n/g, '<br>');

    bodyWrap.appendChild(body);

    row.appendChild(avatar);
    row.appendChild(bodyWrap);

    messagesContainer.appendChild(row);

    lastMessageAuthor = message.author;
    lastMessageTimestamp = msgTime;
}

async function loadGroupHistory(groupId) {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.innerHTML = '';
    lastMessageDayKey = null;
    lastMessageAuthor = null;
    lastMessageTimestamp = 0;
    try {
        const res = await fetch(`/api/groups/${groupId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const messages = await res.json();
            messages.forEach(m => {
                addMessageToUI({
                    id: m.id,
                    author: m.username,
                    avatar: m.avatar || m.username.charAt(0).toUpperCase(),
                    text: m.content,
                    timestamp: m.created_at,
                    groupId
                });
            });
        }
    } catch (err) {
        console.error('Load group history error:', err);
    }
    scrollToBottom();
}

async function loadGroupMembers(groupId) {
    try {
        const res = await fetch(`/api/groups/${groupId}/members`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const members = await res.json();
            renderGroupMembers(members);
        }
    } catch (err) {
        console.error('Load group members error:', err);
    }
}

function renderGroupMembers(members) {
    const panel = document.getElementById('groupMembersPanel');
    const list = document.getElementById('groupMembersList');
    const count = document.getElementById('groupMembersCount');
    if (!panel || !list || !count) return;
    list.innerHTML = '';
    count.textContent = members ? members.length : 0;
    if (!members || members.length === 0) {
        list.innerHTML = '<div class="friends-empty">No members</div>';
        return;
    }
    members.forEach(m => {
        const item = document.createElement('div');
        item.className = 'group-member';
        item.innerHTML = `
            <div class="friend-avatar">${m.avatar || m.username.charAt(0).toUpperCase()}</div>
            <div class="group-member-info">
                <div class="group-member-name">${m.username}</div>
                ${m.id === currentGroupOwnerId ? '<div class="group-owner-label">Owner</div>' : ''}
            </div>
        `;
        list.appendChild(item);
    });
}

function toggleGroupPanel(show) {
    const panel = document.getElementById('groupMembersPanel');
    const chatView = document.getElementById('chatView');
    if (!panel || !chatView) return;
    if (show) {
        panel.classList.remove('hidden');
        chatView.classList.add('group-panel-visible');
    } else {
        panel.classList.add('hidden');
        chatView.classList.remove('group-panel-visible');
    }
}

function formatTimeLabel(date) {
    const d = new Date(date);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}

function formatDayKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(date) {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const isToday = d.toDateString() === today.toDateString();
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';
    return d.toLocaleDateString();
}

function escapeHtml(str) {
    return str.replace(/[&<>\"']/g, (c) => {
        switch (c) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return c;
        }
    });
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Emoji picker
function initializeEmojiPicker() {
    const emojiBtn = document.querySelector('.emoji-btn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', () => {
            showEmojiPickerForInput();
        });
    }
}

function showEmojiPickerForInput() {
    const emojis = ['рџЂ', 'рџ‚', 'вќ¤пёЏ', 'рџ‘Ќ', 'рџ‘Ћ', 'рџЋ‰', 'рџ”Ґ', 'вњЁ', 'рџ’Ї', 'рџљЂ'];
    const picker = createEmojiPicker(emojis, (emoji) => {
        const input = document.getElementById('messageInput');
        input.value += emoji;
        input.focus();
    });
    document.body.appendChild(picker);
}

function showEmojiPickerForMessage(messageId) {
    const emojis = ['рџ‘Ќ', 'вќ¤пёЏ', 'рџ‚', 'рџ®', 'рџў', 'рџЋ‰'];
    const picker = createEmojiPicker(emojis, (emoji) => {
        addReaction(messageId, emoji);
    });
    document.body.appendChild(picker);
}

function createEmojiPicker(emojis, onSelect) {
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-option';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
            onSelect(emoji);
            picker.remove();
        });
        picker.appendChild(btn);
    });
    
    setTimeout(() => {
        document.addEventListener('click', function closePickerAnywhere(e) {
            if (!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePickerAnywhere);
            }
        });
    }, 100);
    
    return picker;
}

function addReaction(messageId, emoji) {
    if (socket && socket.connected) {
        socket.emit('add-reaction', { messageId, emoji });
    }
}

function updateMessageReactions(messageId, reactions) {
    const reactionsContainer = document.querySelector(`[data-message-id="${messageId}"] .message-reactions`);
    if (!reactionsContainer) return;
    
    reactionsContainer.innerHTML = '';
    
    reactions.forEach(reaction => {
        const reactionEl = document.createElement('div');
        reactionEl.className = 'reaction';
        reactionEl.innerHTML = `${reaction.emoji} <span>${reaction.count}</span>`;
        reactionEl.title = reaction.users;
        reactionEl.addEventListener('click', () => {
            if (socket && socket.connected) {
                socket.emit('remove-reaction', { messageId, emoji: reaction.emoji });
            }
        });
        reactionsContainer.appendChild(reactionEl);
    });
}

// File upload
function initializeFileUpload() {
    const attachBtn = document.querySelector('.attach-btn');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            await uploadFile(file);
        }
        fileInput.value = '';
    });
}

async function uploadFile(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('channelId', currentChannel);
        
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        
        const fileData = await response.json();
        
        const message = {
            author: currentUser.username,
            avatar: currentUser.avatar,
            text: `Uploaded ${file.name}`,
            file: fileData,
            timestamp: new Date()
        };
        
        if (socket && socket.connected) {
            socket.emit('send-message', {
                channel: currentChannel,
                message: message
            });
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload file');
    }
}

// User controls
function initializeUserControls() {
    const muteBtn = document.getElementById('muteBtn');
    const deafenBtn = document.getElementById('deafenBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteBtn.querySelector('.icon-normal').style.display = isMuted ? 'none' : 'block';
        muteBtn.querySelector('.icon-slashed').style.display = isMuted ? 'block' : 'none';
        
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    });
    
    deafenBtn.addEventListener('click', () => {
        isDeafened = !isDeafened;
        deafenBtn.querySelector('.icon-normal').style.display = isDeafened ? 'none' : 'block';
        deafenBtn.querySelector('.icon-slashed').style.display = isDeafened ? 'block' : 'none';
        
        // When deafened, also mute microphone
        if (isDeafened) {
            if (!isMuted) {
                isMuted = true;
                muteBtn.querySelector('.icon-normal').style.display = 'none';
                muteBtn.querySelector('.icon-slashed').style.display = 'block';
            }
            
            if (remoteAudioContext) {
                remoteAudioContext.suspend().catch(() => {});
            }
        } else {
            if (remoteAudioContext) {
                remoteAudioContext.resume().catch(() => {});
            }
        }

        // Update local stream audio tracks
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    });
    
    settingsBtn.addEventListener('click', () => openSettings());
}

// Voice channel functions - call persists when switching views
async function joinVoiceChannel(channelName) {
    if (inCall) {
        const callInterface = document.getElementById('callInterface');
        if (callInterface.classList.contains('hidden')) {
            callInterface.classList.remove('hidden');
        }
        return;
    }
    
    inCall = true;
    
    document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
    const channelEl = document.querySelector(`[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('in-call');
    
    const callInterface = document.getElementById('callInterface');
    callInterface.classList.remove('hidden');
    
    document.querySelector('.call-channel-name').textContent = channelName;
    
    try {
        await initializeMedia();
        
        // Connect to the socket for voice
        if (socket && socket.connected) {
            socket.emit('join-voice-channel', { channelName, userId: currentUser.id });
        }

    } catch (error) {
        console.error('Error initializing media:', error);
        alert('Error accessing camera/microphone. Please grant permissions.');
        leaveVoiceChannel(true); // Force leave
    }
}

async function initializeMedia() {
    try {
        // Grab only audio for joining; request camera when video is enabled
        const constraints = buildAudioConstraints({
            sampleRate: 48000,
            sampleSize: 16,
            channelCount: 1
        });

        const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
        applyAudioProcessing(rawStream);
        localStream = await applyRnnoise(rawStream);
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        localVideo.closest('.participant')?.classList.add('video-off');
        isVideoEnabled = false;
        
        // Log audio track status
        const audioTracks = localStream.getAudioTracks();
        console.log('Local audio tracks:', audioTracks.length);
        audioTracks.forEach(track => {
            console.log(`Audio track: ${track.label}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
        });
        
        if (isMuted || isDeafened) {
            audioTracks.forEach(track => {
                track.enabled = false;
            });
        }
    } catch (error) {
        console.error('Error getting media devices:', error);
        throw error;
    }
}

function leaveVoiceChannel(force = false, endSession = false) {
    if (!inCall) return;
    stopRingtone();

    if (force) {
        inCall = false;

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        cleanupRnnoiseGraph(true);
        if (rnnoiseAudioContext) {
            rnnoiseAudioContext.close().catch(() => {});
            rnnoiseAudioContext = null;
            rnnoiseReadyPromise = null;
            rnnoiseModule = null;
        }

        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        
        if (socket && socket.connected) {
            socket.emit('leave-voice-channel', currentChannel);
        }

        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        if (endSession) {
            participantNames = {};
            participantAvatars = {};
            window.currentCallDetails = null;
            callSessionActive = false;
            callStartTime = null;
            stopCallBannerTimer();
        }
        cleanupAllRemoteAudio();
        hadPeerInCall = false;
        resetLonelyTimer();

        document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
        document.getElementById('remoteParticipants').innerHTML = '';
    }

    const callInterface = document.getElementById('callInterface');
    callInterface.classList.add('hidden');

    if (force) {
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = null;
        isVideoEnabled = true;
        isAudioEnabled = true;
        updateCallButtons();
    }
    updateCallBanner();
}

function initializeCallControls() {
    const closeCallBtn = document.getElementById('closeCallBtn');
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    initializeScreenShareSettings();
    
    closeCallBtn.addEventListener('click', () => {
        // Hide call window and leave locally, but keep session info
        stopRingtone();
        leaveVoiceChannel(true, false);
        updateCallBanner();
    });
    
    toggleVideoBtn.addEventListener('click', () => {
        toggleVideo();
    });
    
    toggleAudioBtn.addEventListener('click', () => {
        toggleAudio();
    });
    
    toggleScreenBtn.addEventListener('click', () => {
        toggleScreenShare();
    });
}

function initializeDMCallButton() {
    const callBtn = document.getElementById('callFriendBtn');
    if (!callBtn) return;
    callBtn.addEventListener('click', () => {
        if (!currentDMUserId || !currentDMUsername) return;
        initiateCall(currentDMUserId, 'audio', currentDMUsername);
    });
}

function initializeScreenShareSettings() {
    const resSelect = document.getElementById('screenResSelect');
    const fpsSelect = document.getElementById('screenFpsSelect');

    if (resSelect) {
        const applyRes = () => {
            const [w, h] = resSelect.value.split('x').map(Number);
            if (Number.isFinite(w) && Number.isFinite(h)) {
                screenShareWidth = w;
                screenShareHeight = h;
            }
            if (screenStream) {
                restartScreenShareWithCurrentSettings();
            }
        };
        applyRes();
        resSelect.addEventListener('change', applyRes);
    }

    if (fpsSelect) {
        const applyFps = () => {
            const fps = parseInt(fpsSelect.value, 10);
            if (Number.isFinite(fps) && fps >= 30 && fps <= 120) {
                screenShareFps = fps;
            }
            if (screenStream) {
                restartScreenShareWithCurrentSettings();
            }
        };
        applyFps();
        fpsSelect.addEventListener('change', applyFps);
    }
}

async function restartScreenShareWithCurrentSettings() {
    // Stop current share (fallback to camera to avoid black frames)
    stopScreenShare(true);
    // Immediately start with new constraints
    await startScreenShareWithCurrentSettings();
}

function toggleVideo() {
    // Request camera only when user explicitly enables video
    if (!localStream) return;

    const existingVideoTracks = localStream.getVideoTracks();
    const needNewVideoTrack = existingVideoTracks.length === 0;

    const enableExistingVideo = () => {
        isVideoEnabled = !isVideoEnabled;
        localStream.getVideoTracks().forEach(track => {
            track.enabled = isVideoEnabled;
        });
    };

    const notifyPeers = () => {
        Object.keys(peerConnections).forEach(socketId => {
            if (socket && socket.connected) {
                socket.emit('video-toggle', {
                    to: socketId,
                    enabled: isVideoEnabled
                });
            }
        });
    };

    if (needNewVideoTrack) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(videoStream => {
                const videoTrack = videoStream.getVideoTracks()[0];
                if (!videoTrack) {
                    throw new Error('No video track available');
                }

                localStream.addTrack(videoTrack);

                // Add the track to peers and renegotiate
                Object.entries(peerConnections).forEach(([socketId, pc]) => {
                    try {
                        pc.addTrack(videoTrack, localStream);
                        renegotiateConnection(socketId, pc);
                    } catch (err) {
                        console.error('Error adding video track to peer:', err);
                    }
                });

                // Refresh local video element
                const localVideo = document.getElementById('localVideo');
                localVideo.srcObject = null;
                localVideo.srcObject = localStream;
                localVideo.closest('.participant')?.classList.remove('video-off');

                isVideoEnabled = true;
                notifyPeers();
                updateCallButtons();
            })
            .catch(error => {
                console.error('Camera permission denied or error:', error);
                alert('Could not access camera. Please allow camera permissions in the browser.');
            });
    } else {
        enableExistingVideo();
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
            if (isVideoEnabled) {
                localVideo.closest('.participant')?.classList.remove('video-off');
            } else {
                localVideo.closest('.participant')?.classList.add('video-off');
            }
        }
        scheduleLonelyHangup();
        notifyPeers();
        updateCallButtons();
    }
}

function toggleAudio() {
    if (!localStream) return;
    
    isAudioEnabled = !isAudioEnabled;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });
    
    if (!isAudioEnabled) {
        isMuted = true;
        document.getElementById('muteBtn').classList.add('active');
    } else {
        isMuted = false;
        document.getElementById('muteBtn').classList.remove('active');
    }
    
    updateCallButtons();
}

async function renegotiateConnection(socketId, pc) {
    if (!pc || pc.signalingState !== 'stable') return;
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (socket && socket.connected) {
            socket.emit('offer', {
                to: socketId,
                offer: pc.localDescription
            });
        }
    } catch (error) {
        console.error('Renegotiation error:', error);
    }
}

async function toggleScreenShare() {
    if (screenStream) {
        stopScreenShare(true);
    } else {
        await startScreenShareWithCurrentSettings();
    }
}

function stopScreenShare(fallbackToCamera = true) {
    if (!screenStream) return;

    screenStream.getTracks().forEach(track => track.stop());
    
    // Replace screen track with camera track (or null) in all peer connections
    const videoTrack = localStream.getVideoTracks()[0];
    Object.entries(peerConnections).forEach(([socketId, pc]) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            if (fallbackToCamera && videoTrack) {
                sender.replaceTrack(videoTrack);
            } else {
                sender.replaceTrack(null);
            }
            renegotiateConnection(socketId, pc);
        }
    });
    
    screenStream = null;
    
    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = localStream;
    
    updateCallButtons();
}

async function startScreenShareWithCurrentSettings() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                width: { ideal: screenShareWidth },
                height: { ideal: screenShareHeight },
                frameRate: { ideal: screenShareFps, max: screenShareFps }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });
        
        const screenTrack = screenStream.getVideoTracks()[0];
        
        // Replace video track in all peer connections
        Object.entries(peerConnections).forEach(([socketId, pc]) => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(screenTrack);
                renegotiateConnection(socketId, pc);
            } else {
                try {
                    pc.addTrack(screenTrack, screenStream);
                    renegotiateConnection(socketId, pc);
                } catch (err) {
                    console.error('Error adding screen track to peer:', err);
                }
            }
        });
        
        // Show screen share in local video
        const localVideo = document.getElementById('localVideo');
        const mixedStream = new MediaStream([
            screenTrack,
            ...localStream.getAudioTracks()
        ]);
        localVideo.srcObject = mixedStream;
        
        // Handle screen share ending
        screenTrack.addEventListener('ended', () => {
            toggleScreenShare(); // This will stop screen sharing
        });
        
        updateCallButtons();
    } catch (error) {
        console.error('Error sharing screen:', error);
        if (error.name === 'NotAllowedError') {
            alert('Screen sharing permission denied');
        } else {
            alert('Error sharing screen. Please try again.');
        }
    }
}

function updateCallButtons() {
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    if (toggleVideoBtn) {
        toggleVideoBtn.classList.toggle('active', !isVideoEnabled);
    }
    
    if (toggleAudioBtn) {
        toggleAudioBtn.classList.toggle('active', !isAudioEnabled);
    }
    
    if (toggleScreenBtn) {
        toggleScreenBtn.classList.toggle('active', screenStream !== null);
    }
}

function initializeDraggableCallWindow() {
   const callInterface = document.getElementById('callInterface');
   const callHeader = callInterface.querySelector('.call-header');
   let isDragging = false;
   let offsetX, offsetY;

   callHeader.addEventListener('mousedown', (e) => {
       isDragging = true;
       offsetX = e.clientX - callInterface.offsetLeft;
       offsetY = e.clientY - callInterface.offsetTop;
       callInterface.style.transition = 'none'; // Disable transition during drag
   });

   document.addEventListener('mousemove', (e) => {
       if (isDragging) {
           let newX = e.clientX - offsetX;
           let newY = e.clientY - offsetY;

           // Constrain within viewport
           const maxX = window.innerWidth - callInterface.offsetWidth;
           const maxY = window.innerHeight - callInterface.offsetHeight;

           newX = Math.max(0, Math.min(newX, maxX));
           newY = Math.max(0, Math.min(newY, maxY));

           callInterface.style.left = `${newX}px`;
           callInterface.style.top = `${newY}px`;
       }
   });

   document.addEventListener('mouseup', () => {
       if (isDragging) {
           isDragging = false;
           callInterface.style.transition = 'all 0.3s ease'; // Re-enable transition
       }
   });
}

function getChannelIdByName(name) {
   // This is a temporary solution. A better approach would be to have a proper mapping.
   return name === 'general' ? 1 : 2;
}

function getChannelNameById(id) {
   // This is a temporary solution. A better approach would be to have a proper mapping.
   return id === 1 ? 'general' : 'random';
}

async function loadDMHistory(userId) {
   const messagesContainer = document.getElementById('messagesContainer');
   messagesContainer.innerHTML = '';
   lastMessageDayKey = null;
   lastMessageAuthor = null;
   lastMessageTimestamp = 0;

   try {
       const response = await fetch(`/api/dm/${userId}`, {
           headers: { 'Authorization': `Bearer ${token}` }
       });
       if (response.ok) {
           const messages = await response.json();
           messages.forEach(message => {
               addMessageToUI({
                   id: message.id,
                   author: message.username,
                   avatar: message.avatar || message.username.charAt(0).toUpperCase(),
                   text: message.content,
                   timestamp: message.created_at
               });
           });
       } else {
           console.error('Failed to load DM history');
       }
   } catch (error) {
       console.error('Error loading DM history:', error);
   }

   scrollToBottom();
}

console.log('Discord Clone initialized successfully!');
if (currentUser) {
   console.log('Logged in as:', currentUser.username);
}

function populateDMList(friends) {
   const dmList = document.getElementById('dmList');
   dmList.innerHTML = '';

   if (friends.length === 0) {
       const emptyDM = document.createElement('div');
       emptyDM.className = 'empty-dm-list';
       emptyDM.textContent = 'No conversations yet.';
       dmList.appendChild(emptyDM);
       return;
   }

    friends.forEach(friend => {
        const dmItem = document.createElement('div');
        dmItem.className = 'channel';
        dmItem.setAttribute('data-dm-id', friend.id);
        dmItem.innerHTML = `
           <div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>
           <span>${friend.username}</span>
       `;
       dmItem.addEventListener('click', () => {
           startDM(friend.id, friend.username);
       });
       dmList.appendChild(dmItem);
   });
}

// WebRTC Functions
function createPeerConnection(remoteSocketId, isInitiator) {
    console.log(`Creating peer connection with ${remoteSocketId}, initiator: ${isInitiator}`);
    
    if (peerConnections[remoteSocketId]) {
        console.log('Peer connection already exists');
        return peerConnections[remoteSocketId];
    }
    resetLonelyTimer();
    hadPeerInCall = true;
    
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
    });

    peerConnections[remoteSocketId] = pc;

    // Add local stream tracks with better error handling
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        const videoTracks = localStream.getVideoTracks();
        
        console.log(`Adding tracks - Audio: ${audioTracks.length}, Video: ${videoTracks.length}`);
        
        // Add audio tracks first (priority for voice calls)
        audioTracks.forEach(track => {
            console.log(`Adding audio track: ${track.label}, enabled: ${track.enabled}`);
            pc.addTrack(track, localStream);
        });
        
        // Then add video tracks
        videoTracks.forEach(track => {
            console.log(`Adding video track: ${track.label}, enabled: ${track.enabled}`);
            pc.addTrack(track, localStream);
        });
    } else {
        console.error('No local stream available');
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate');
            socket.emit('ice-candidate', {
                to: remoteSocketId,
                candidate: event.candidate
            });
        }
    };
    
    // Handle connection state changes
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed') {
            console.error('ICE connection failed');
            // Try to restart ICE
            pc.restartIce();
        }
        if (pc.iceConnectionState === 'connected') {
            console.log('Peer connection established successfully!');
        }
    };

    // Handle incoming remote stream
    pc.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind, 'Stream ID:', event.streams[0]?.id);
        
        const remoteParticipants = document.getElementById('remoteParticipants');
        
        let participantDiv = document.getElementById(`participant-${remoteSocketId}`);
        let remoteVideo = document.getElementById(`remote-${remoteSocketId}`);
        const displayName = getParticipantName(remoteSocketId);
        const avatarLetter = getParticipantAvatar(remoteSocketId, displayName?.charAt(0)?.toUpperCase());
        
        if (!participantDiv) {
            participantDiv = document.createElement('div');
            participantDiv.className = 'participant video-off';
            participantDiv.id = `participant-${remoteSocketId}`;
            
            const placeholder = document.createElement('div');
            placeholder.className = 'avatar-placeholder';
            placeholder.innerHTML = `<div class="avatar-circle">${avatarLetter}</div>`;
            
            remoteVideo = document.createElement('video');
            remoteVideo.id = `remote-${remoteSocketId}`;
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideo.volume = isDeafened ? 0 : 1; // Respect deafened state
            remoteVideo.muted = true; // Audio handled via WebAudio graph
            
            const participantName = document.createElement('div');
            participantName.className = 'participant-name';
            participantName.textContent = displayName;
            
            participantDiv.appendChild(placeholder);
            participantDiv.appendChild(remoteVideo);
            participantDiv.appendChild(participantName);
            remoteParticipants.appendChild(participantDiv);
        } else {
            const nameEl = participantDiv.querySelector('.participant-name');
            if (nameEl) {
                nameEl.textContent = displayName;
            }
            const avatarEl = participantDiv.querySelector('.avatar-circle');
            if (avatarEl) {
                avatarEl.textContent = avatarLetter;
            }
        }
        
        // Set the stream to the video element
        if (event.streams && event.streams[0]) {
            console.log('Setting remote stream to video element');
            remoteVideo = document.getElementById(`remote-${remoteSocketId}`);
            if (remoteVideo) {
                remoteVideo.srcObject = event.streams[0];
                remoteVideo.muted = true; // Playback is handled via WebAudio graph with gain control
                const hasVideoTrack = event.streams[0].getVideoTracks().length > 0;
                if (hasVideoTrack) {
                    participantDiv.classList.remove('video-off');
                }
                
                // Ensure audio is playing
                remoteVideo.play().catch(e => {
                    console.error('Error playing remote video:', e);
                    // Try to play after user interaction
                    document.addEventListener('click', () => {
                        remoteVideo.play().catch(err => console.error('Still cannot play:', err));
                    }, { once: true });
                });
            }
            if (event.track.kind === 'audio') {
                attachRemoteAudio(remoteSocketId, event.streams[0]);
            } else if (event.track.kind === 'video') {
                participantDiv.classList.remove('video-off');
                event.track.onended = () => {
                    participantDiv.classList.add('video-off');
                };
            }
        }
        
        attachVolumeMenu(participantDiv, remoteSocketId);
        
        // Initialize resizable videos
        function initializeResizableVideos() {
            const callInterface = document.getElementById('callInterface');
            const participants = callInterface.querySelectorAll('.participant');
            
            participants.forEach(participant => {
                makeResizable(participant);
            });
            
            // Make call interface resizable too
            makeInterfaceResizable(callInterface);
        }
        
        // Make individual video resizable
        function makeResizable(element) {
            // Add resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.innerHTML = 'в†';
            resizeHandle.style.cssText = `
                position: absolute;
                bottom: 5px;
                right: 5px;
                width: 20px;
                height: 20px;
                background: rgba(255,255,255,0.3);
                cursor: nwse-resize;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 3px;
                font-size: 12px;
                color: white;
                user-select: none;
            `;
            
            // Add video size controls
            const sizeControls = document.createElement('div');
            sizeControls.className = 'video-size-controls';
            sizeControls.innerHTML = `
                <button class="size-control-btn minimize-btn" title="Minimize">_</button>
                <button class="size-control-btn maximize-btn" title="Maximize">в–Ў</button>
                <button class="size-control-btn fullscreen-btn" title="Fullscreen">в›¶</button>
            `;
            
            if (!element.querySelector('.resize-handle')) {
                element.appendChild(resizeHandle);
                element.appendChild(sizeControls);
                element.style.resize = 'both';
                element.style.overflow = 'auto';
                element.style.minWidth = '150px';
                element.style.minHeight = '100px';
                element.style.maxWidth = '90vw';
                element.style.maxHeight = '90vh';
                element.setAttribute('data-resizable', 'true');
                
                // Add double-click for fullscreen
                element.addEventListener('dblclick', function(e) {
                    if (!e.target.closest('.video-size-controls')) {
                        toggleVideoFullscreen(element);
                    }
                });
                
                // Size control buttons
                const minimizeBtn = sizeControls.querySelector('.minimize-btn');
                const maximizeBtn = sizeControls.querySelector('.maximize-btn');
                const fullscreenBtn = sizeControls.querySelector('.fullscreen-btn');
                
                minimizeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    element.classList.toggle('minimized');
                    element.classList.remove('maximized');
                });
                
                maximizeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    element.classList.toggle('maximized');
                    element.classList.remove('minimized');
                });
                
                fullscreenBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const video = element.querySelector('video');
                    if (video && video.requestFullscreen) {
                        video.requestFullscreen();
                    }
                });
            }
        }
        
        // Toggle video fullscreen
        function toggleVideoFullscreen(element) {
            element.classList.toggle('maximized');
            if (element.classList.contains('maximized')) {
                element.classList.remove('minimized');
            }
        }
        
        // Make call interface resizable
        function makeInterfaceResizable(callInterface) {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'interface-resize-handle';
            resizeHandle.style.cssText = `
                position: absolute;
                bottom: 0;
                right: 0;
                width: 15px;
                height: 15px;
                cursor: nwse-resize;
                background: linear-gradient(135deg, transparent 50%, #5865f2 50%);
                border-bottom-right-radius: 12px;
            `;
            
            if (!callInterface.querySelector('.interface-resize-handle')) {
                callInterface.appendChild(resizeHandle);
                
                let isResizing = false;
                let startWidth = 0;
                let startHeight = 0;
                let startX = 0;
                let startY = 0;
                
                resizeHandle.addEventListener('mousedown', (e) => {
                    isResizing = true;
                    startWidth = parseInt(document.defaultView.getComputedStyle(callInterface).width, 10);
                    startHeight = parseInt(document.defaultView.getComputedStyle(callInterface).height, 10);
                    startX = e.clientX;
                    startY = e.clientY;
                    e.preventDefault();
                });
                
                document.addEventListener('mousemove', (e) => {
                    if (!isResizing) return;
                    
                    const newWidth = startWidth + e.clientX - startX;
                    const newHeight = startHeight + e.clientY - startY;
                    
                    if (newWidth > 300 && newWidth < window.innerWidth * 0.9) {
                        callInterface.style.width = newWidth + 'px';
                    }
                    if (newHeight > 200 && newHeight < window.innerHeight * 0.9) {
                        callInterface.style.height = newHeight + 'px';
                    }
                });
                
                document.addEventListener('mouseup', () => {
                    isResizing = false;
                });
            }
        }
        
        // Update resizable functionality when new participants join
        const originalOntrack = RTCPeerConnection.prototype.ontrack;
        window.observeNewParticipants = function() {
            setTimeout(() => {
                const participants = document.querySelectorAll('.participant:not([data-resizable])');
                participants.forEach(participant => {
                    participant.setAttribute('data-resizable', 'true');
                    makeResizable(participant);
                });
            }, 500);
        };
        
        // Make the new participant video resizable after a short delay
        setTimeout(() => {
            if (typeof makeResizable === 'function' && participantDiv) {
                makeResizable(participantDiv);
            }
        }, 100);
    };

    // Create offer if initiator with modern constraints
    if (isInitiator) {
        pc.createOffer()
        .then(offer => {
            console.log('Created offer with SDP:', offer.sdp.substring(0, 200));
            return pc.setLocalDescription(offer);
        })
        .then(() => {
            console.log('Sending offer to:', remoteSocketId);
            socket.emit('offer', {
                to: remoteSocketId,
                offer: pc.localDescription
            });
        })
        .catch(error => {
            console.error('Error creating offer:', error);
        });
    }
    
    return pc;
}

// Initialize resizable videos
function initializeResizableVideos() {
    const callInterface = document.getElementById('callInterface');
    if (!callInterface) return;
    
    const participants = callInterface.querySelectorAll('.participant');
    participants.forEach(participant => {
        makeResizable(participant);
    });
    
    // Make call interface resizable too
    makeInterfaceResizable(callInterface);
}

// Make individual video resizable
function makeResizable(element) {
    if (!element || element.hasAttribute('data-resizable')) return;
    
    // Add resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.innerHTML = 'в†';
    resizeHandle.style.cssText = `
        position: absolute;
        bottom: 5px;
        right: 5px;
        width: 20px;
        height: 20px;
        background: rgba(255,255,255,0.3);
        cursor: nwse-resize;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        font-size: 12px;
        color: white;
        user-select: none;
        z-index: 10;
    `;
    
    // Add video size controls
    const sizeControls = document.createElement('div');
    sizeControls.className = 'video-size-controls';
    sizeControls.innerHTML = `
        <button class="size-control-btn minimize-btn" title="Minimize">_</button>
        <button class="size-control-btn maximize-btn" title="Maximize">в–Ў</button>
        <button class="size-control-btn fullscreen-btn" title="Fullscreen">в›¶</button>
    `;
    sizeControls.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: 10;
    `;
    
    element.appendChild(resizeHandle);
    element.appendChild(sizeControls);
    element.style.resize = 'both';
    element.style.overflow = 'auto';
    element.style.minWidth = '150px';
    element.style.minHeight = '100px';
    element.style.maxWidth = '90vw';
    element.style.maxHeight = '90vh';
    element.setAttribute('data-resizable', 'true');
    
    // Show controls on hover
    element.addEventListener('mouseenter', () => {
        sizeControls.style.opacity = '1';
    });
    
    element.addEventListener('mouseleave', () => {
        sizeControls.style.opacity = '0';
    });
    
    // Add double-click for fullscreen
    element.addEventListener('dblclick', function(e) {
        if (!e.target.closest('.video-size-controls')) {
            toggleVideoFullscreen(element);
        }
    });
    
    // Size control buttons
    const minimizeBtn = sizeControls.querySelector('.minimize-btn');
    const maximizeBtn = sizeControls.querySelector('.maximize-btn');
    const fullscreenBtn = sizeControls.querySelector('.fullscreen-btn');
    
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            element.classList.toggle('minimized');
            element.classList.remove('maximized');
        });
    }
    
    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            element.classList.toggle('maximized');
            element.classList.remove('minimized');
        });
    }
    
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const video = element.querySelector('video');
            if (video && video.requestFullscreen) {
                video.requestFullscreen();
            }
        });
    }
}

// Toggle video fullscreen
function toggleVideoFullscreen(element) {
    element.classList.toggle('maximized');
    if (element.classList.contains('maximized')) {
        element.classList.remove('minimized');
    }
}

// Make interface resizable
function makeInterfaceResizable(callInterface) {
    if (!callInterface || callInterface.hasAttribute('data-interface-resizable')) return;
    
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'interface-resize-handle';
    resizeHandle.style.cssText = `
        position: absolute;
        bottom: 0;
        right: 0;
        width: 15px;
        height: 15px;
        cursor: nwse-resize;
        background: linear-gradient(135deg, transparent 50%, #5865f2 50%);
        border-bottom-right-radius: 12px;
    `;
    
    callInterface.appendChild(resizeHandle);
    callInterface.setAttribute('data-interface-resizable', 'true');
    
    let isResizing = false;
    let startWidth = 0;
    let startHeight = 0;
    let startX = 0;
    let startY = 0;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startWidth = parseInt(document.defaultView.getComputedStyle(callInterface).width, 10);
        startHeight = parseInt(document.defaultView.getComputedStyle(callInterface).height, 10);
        startX = e.clientX;
        startY = e.clientY;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const newWidth = startWidth + e.clientX - startX;
        const newHeight = startHeight + e.clientY - startY;
        
        if (newWidth > 400 && newWidth < window.innerWidth * 0.9) {
            callInterface.style.width = newWidth + 'px';
        }
        if (newHeight > 300 && newHeight < window.innerHeight * 0.9) {
            callInterface.style.height = newHeight + 'px';
        }
    });
    
    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}

