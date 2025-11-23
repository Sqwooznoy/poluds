const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
// Passwords are stored in plain text (no hashing)
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');

const { initializeDatabase, userDB, messageDB, dmDB, fileDB, reactionDB, friendDB, serverDB, groupDB } = require('./database');

// Store connected users and rooms
const users = new Map();
const rooms = new Map();
const activeCalls = new Map(); // socketId -> peerSocketId

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Allow all common file types
        const allowedMimeTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'audio/mpeg', 'audio/mp3', 'video/mp4', 'video/webm', 'video/quicktime',
            'application/zip', 'application/x-rar-compressed'
        ];
        
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.pdf', '.doc', '.docx',
                                   '.txt', '.mp3', '.mp4', '.webm', '.mov', '.zip', '.rar'];
        
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(null, true); // Allow all files for now, can restrict later
        }
    }
});

// Initialize database
initializeDatabase();

// JWT middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// API Routes

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        const existingUser = await userDB.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        // Store password as-is (no hashing)
        const user = await userDB.create(username, email, password);
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: username.charAt(0).toUpperCase()
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const user = await userDB.findByEmail(email);
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        if (password !== user.password) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar || user.username.charAt(0).toUpperCase()
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Helpers
async function isGroupOwner(groupId, userId) {
    const group = await groupDB.getGroupById(groupId);
    return group && group.owner_id === userId;
}

async function isGroupMember(groupId, userId) {
    const members = await groupDB.getMembers(groupId);
    return members.some(m => m.id === userId);
}

// Group routes
app.get('/api/groups', authenticateToken, async (req, res) => {
    try {
        const groups = await groupDB.getGroupsForUser(req.user.id);
        res.json(groups);
    } catch (error) {
        console.error('Get groups error:', error);
        res.status(500).json({ error: 'Failed to load groups' });
    }
});

app.post('/api/groups', authenticateToken, async (req, res) => {
    try {
        const { name, memberIds } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length < 3) {
            return res.status(400).json({ error: 'Group name too short' });
        }
        const group = await groupDB.createGroup(name.trim(), req.user.id);
        const members = Array.isArray(memberIds) ? memberIds : [];
        await groupDB.addMember(group.id, req.user.id);
        for (const mid of members) {
            await groupDB.addMember(group.id, mid);
        }
        const memberList = await groupDB.getMembers(group.id);
        res.json({ group: { ...group, members: memberList } });
    } catch (error) {
        console.error('Create group error:', error);
        res.status(500).json({ error: 'Failed to create group' });
    }
});

app.get('/api/groups/:id/messages', authenticateToken, async (req, res) => {
    try {
        const messages = await groupDB.getMessages(req.params.id, 100);
        res.json(messages);
    } catch (error) {
        console.error('Group messages error:', error);
        res.status(500).json({ error: 'Failed to load group messages' });
    }
});

app.get('/api/groups/:id/members', authenticateToken, async (req, res) => {
    try {
        const members = await groupDB.getMembers(req.params.id);
        res.json(members);
    } catch (error) {
        console.error('Group members error:', error);
        res.status(500).json({ error: 'Failed to load group members' });
    }
});

app.post('/api/groups/:id/members', authenticateToken, async (req, res) => {
    try {
        const groupId = req.params.id;
        const { userId } = req.body;
        if (!await isGroupOwner(groupId, req.user.id)) {
            return res.status(403).json({ error: 'Only owner can add members' });
        }
        await groupDB.addMember(groupId, userId);
        const members = await groupDB.getMembers(groupId);
        res.json({ members });
    } catch (error) {
        console.error('Add member error:', error);
        res.status(500).json({ error: 'Failed to add member' });
    }
});

app.delete('/api/groups/:id/members/:userId', authenticateToken, async (req, res) => {
    try {
        const groupId = req.params.id;
        const targetId = parseInt(req.params.userId, 10);
        const isOwner = await isGroupOwner(groupId, req.user.id);
        if (!isOwner && targetId !== req.user.id) {
            return res.status(403).json({ error: 'Not allowed' });
        }
        await groupDB.removeMember(groupId, targetId);
        const members = await groupDB.getMembers(groupId);
        res.json({ members });
    } catch (error) {
        console.error('Remove member error:', error);
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

app.delete('/api/groups/:id', authenticateToken, async (req, res) => {
    try {
        const groupId = req.params.id;
        if (!await isGroupOwner(groupId, req.user.id)) {
            return res.status(403).json({ error: 'Only owner can delete group' });
        }
        await groupDB.deleteGroup(groupId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Delete group error:', error);
        res.status(500).json({ error: 'Failed to delete group' });
    }
});

async function handleProfileUpdate(req, res) {
    try {
        const { username, currentPassword, newPassword } = req.body;
        if (!username && !newPassword) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        const user = await userDB.findByIdWithPassword(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updates = {};

        if (username) {
            if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 20) {
                return res.status(400).json({ error: 'Username must be 3-20 characters' });
            }
            const trimmed = username.trim();
            if (trimmed !== user.username) {
                updates.username = trimmed;
            }
        }

        if (newPassword) {
            if (!currentPassword || currentPassword !== user.password) {
                return res.status(400).json({ error: 'Current password incorrect' });
            }
            if (newPassword.length < 6) {
                return res.status(400).json({ error: 'New password too short' });
            }
            updates.password = newPassword;
        }

        if (!updates.username && !updates.password) {
            // Nothing changed
            const current = await userDB.findById(req.user.id);
            return res.json({
                user: {
                    id: current.id,
                    username: current.username,
                    email: current.email,
                    avatar: current.avatar || current.username.charAt(0).toUpperCase()
                }
            });
        }

        await userDB.updateProfile({ id: req.user.id, ...updates });

        const updated = await userDB.findById(req.user.id);

        // Update connected socket user info
        users.forEach((u, socketId) => {
            if (u.id === req.user.id) {
                users.set(socketId, { ...u, username: updated.username, avatar: updated.avatar || updated.username.charAt(0).toUpperCase() });
            }
        });
        io.emit('user-list-update', Array.from(users.values()));
        io.emit('user-renamed', {
            id: updated.id,
            username: updated.username,
            avatar: updated.avatar || updated.username.charAt(0).toUpperCase()
        });

        res.json({
            user: {
                id: updated.id,
                username: updated.username,
                email: updated.email,
                avatar: updated.avatar || updated.username.charAt(0).toUpperCase()
            }
        });
    } catch (error) {
        if (error && error.message && error.message.includes('UNIQUE constraint failed: users.username')) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile', detail: error?.message });
    }
}

// Update profile (username/password)
app.patch('/api/user', authenticateToken, handleProfileUpdate);
app.put('/api/user', authenticateToken, handleProfileUpdate);
app.post('/api/user/update', authenticateToken, handleProfileUpdate);

// Get user profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = await userDB.findById(req.user.id);
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// Get all users
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const users = await userDB.getAll();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// File upload
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const { channelId } = req.body;
        const fileRecord = await fileDB.create(
            req.file.filename,
            req.file.path,
            req.file.mimetype,
            req.file.size,
            req.user.id,
            channelId
        );
        
        res.json({
            id: fileRecord.id,
            filename: req.file.originalname,
            url: `/uploads/${req.file.filename}`,
            type: req.file.mimetype,
            size: req.file.size
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Get messages by channel
app.get('/api/messages/:channelId', authenticateToken, async (req, res) => {
    try {
        const messages = await messageDB.getByChannel(req.params.channelId);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// Get direct messages
app.get('/api/dm/:userId', authenticateToken, async (req, res) => {
    try {
        const messages = await dmDB.getConversation(req.user.id, req.params.userId);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// Server routes
app.post('/api/servers', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || name.trim().length < 2) {
            return res.status(400).json({ error: 'Server name must be at least 2 characters' });
        }
        
        const server = await serverDB.create(name.trim(), req.user.id);
        await serverDB.addMember(server.id, req.user.id);
        
        res.json(server);
    } catch (error) {
        console.error('Create server error:', error);
        res.status(500).json({ error: 'Failed to create server' });
    }
});

app.get('/api/servers', authenticateToken, async (req, res) => {
    try {
        const servers = await serverDB.getUserServers(req.user.id);
        res.json(servers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get servers' });
    }
});

app.get('/api/servers/:serverId/members', authenticateToken, async (req, res) => {
    try {
        const members = await serverDB.getMembers(req.params.serverId);
        res.json(members);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get server members' });
    }
});

app.get('/api/friends', authenticateToken, async (req, res) => {
    try {
        const friends = await friendDB.getFriends(req.user.id);
        res.json(friends);
    } catch (error) {
        console.error('Get friends error:', error);
        res.status(500).json({ error: 'Failed to get friends' });
    }
});

app.get('/api/friends/pending', authenticateToken, async (req, res) => {
    try {
        const requests = await friendDB.getPendingRequests(req.user.id);
        res.json(requests);
    } catch (error) {
        console.error('Get pending requests error:', error);
        res.status(500).json({ error: 'Failed to get pending requests' });
    }
});

// Friend request routes
app.post('/api/friends/request', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        const result = await friendDB.sendRequest(req.user.id, friendId);

        if (result.changes > 0) {
            const receiverSocket = Array.from(users.values()).find(u => u.id === friendId);
            if (receiverSocket) {
                io.to(receiverSocket.socketId).emit('new-friend-request');
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Friend request error:', error);
        res.status(500).json({ error: 'Failed to send friend request' });
    }
});

app.post('/api/friends/accept', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.acceptRequest(req.user.id, friendId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Accept friend request error:', error);
        res.status(500).json({ error: 'Failed to accept friend request' });
    }
});

app.post('/api/friends/reject', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.rejectRequest(req.user.id, friendId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Reject friend request error:', error);
        res.status(500).json({ error: 'Failed to reject friend request' });
    }
});

app.delete('/api/friends/:friendId', authenticateToken, async (req, res) => {
    try {
        await friendDB.removeFriend(req.user.id, req.params.friendId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Remove friend error:', error);
        res.status(500).json({ error: 'Failed to remove friend' });
    }
});

// Socket.IO connection handling
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        socket.userId = decoded.id;
        socket.userEmail = decoded.email;
        next();
    });
});

io.on('connection', async (socket) => {
    console.log('User connected:', socket.userId);
    
    try {
        const user = await userDB.findById(socket.userId);
        
        users.set(socket.id, {
            ...user,
            socketId: socket.id
        });
        
        // Update user status
        await userDB.updateStatus(socket.userId, 'Online');
        
        io.emit('user-list-update', Array.from(users.values()));
    } catch (error) {
        console.error('Error loading user:', error);
    }

    // User sends message
    socket.on('send-message', async (messageData) => {
        try {
            const { channelId, message } = messageData;
            
            // Get user info
            const user = await userDB.findById(socket.userId);
            
            // Save to database
            const savedMessage = await messageDB.create(
                message.text,
                socket.userId,
                channelId
            );
            
            // Broadcast message with full user info
            const broadcastMessage = {
                id: savedMessage.id,
                author: user.username,
                avatar: user.avatar || user.username.charAt(0).toUpperCase(),
                text: message.text,
                timestamp: new Date() // Client will format this
            };
            
            io.emit('new-message', {
                channelId,
                message: broadcastMessage
            });
        } catch (error) {
            console.error('Message error:', error);
        }
    });

    // Direct message
    socket.on('send-dm', async (data) => {
        try {
            const { receiverId, message } = data;
            const sender = await userDB.findById(socket.userId);

            const savedMessage = await dmDB.create(
                message.text,
                socket.userId,
                receiverId
            );

            const messagePayload = {
                id: savedMessage.id,
                author: sender.username,
                avatar: sender.avatar || sender.username.charAt(0).toUpperCase(),
                text: message.text,
                timestamp: new Date()
            };

            // Send to receiver
            const receiverSocket = Array.from(users.values())
                .find(u => u.id === receiverId);
            
            if (receiverSocket) {
                io.to(receiverSocket.socketId).emit('new-dm', {
                    senderId: socket.userId,
                    message: messagePayload
                });
            }
            
            // Send back to sender
            socket.emit('dm-sent', {
                receiverId,
                message: messagePayload
            });
        } catch (error) {
            console.error('DM error:', error);
        }
    });

    // Add reaction
    socket.on('add-reaction', async (data) => {
        try {
            const { messageId, emoji } = data;
            await reactionDB.add(emoji, messageId, socket.userId);
            
            const reactions = await reactionDB.getByMessage(messageId);
            io.emit('reaction-update', { messageId, reactions });
        } catch (error) {
            console.error('Reaction error:', error);
        }
    });

    // Remove reaction
    socket.on('remove-reaction', async (data) => {
        try {
            const { messageId, emoji } = data;
            await reactionDB.remove(emoji, messageId, socket.userId);
            
            const reactions = await reactionDB.getByMessage(messageId);
            io.emit('reaction-update', { messageId, reactions });
        } catch (error) {
            console.error('Reaction error:', error);
        }
    });

    // Voice activity detection
    socket.on('voice-activity', (data) => {
        socket.broadcast.emit('user-speaking', {
            userId: socket.userId,
            speaking: data.speaking
        });
    });

    // Join voice channel
    socket.on('join-voice-channel', (channelData) => {
        const { channelName, userId } = channelData;
        const user = users.get(socket.id);
        
        socket.join(`voice-${channelName}`);
        
        if (!rooms.has(channelName)) {
            rooms.set(channelName, new Set());
        }
        rooms.get(channelName).add(socket.id);
        
        socket.to(`voice-${channelName}`).emit('user-joined-voice', {
            userId,
            socketId: socket.id,
            username: user?.username,
            avatar: user?.avatar || user?.username?.charAt(0).toUpperCase()
        });
        
        const existingUsers = Array.from(rooms.get(channelName))
            .filter(id => id !== socket.id)
            .map(id => users.get(id));
        
        socket.emit('existing-voice-users', existingUsers);
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('leave-voice-channel', (channelName) => {
        socket.leave(`voice-${channelName}`);
        
        if (rooms.has(channelName)) {
            rooms.get(channelName).delete(socket.id);
            socket.to(`voice-${channelName}`).emit('user-left-voice', socket.id);
        }
    });

    // Handle call initiation
    socket.on('initiate-call', (data) => {
        const { to, type, from } = data;
        console.log(`Call initiated from ${from.id} to ${to}, type: ${type}`);
        
        // Find receiver socket
        const receiverSocket = Array.from(users.values()).find(u => u.id === to);
        if (receiverSocket) {
            // Send incoming call notification to receiver
            io.to(receiverSocket.socketId).emit('incoming-call', {
                from: {
                    id: from.id,
                    username: from.username,
                    socketId: socket.id,
                    avatar: from.avatar || from.username?.charAt(0).toUpperCase()
                },
                type: type
            });
        } else {
            // User is offline
            socket.emit('call-rejected', { message: 'User is offline' });
        }
    });

    socket.on('accept-call', (data) => {
        const { to, from } = data;
        console.log(`Call accepted by ${from.id}, connecting to ${to}`);
        
        // Notify the caller that call was accepted
        io.to(to).emit('call-accepted', {
            from: {
                id: from.id,
                username: from.username,
                socketId: socket.id,
                avatar: from.avatar || from.username?.charAt(0).toUpperCase()
            }
        });

        // Track active direct call between sockets
        activeCalls.set(socket.id, to);
        activeCalls.set(to, socket.id);
    });

    socket.on('reject-call', (data) => {
        const { to } = data;
        console.log(`Call rejected, notifying ${to}`);
        
        // Notify the caller that call was rejected
        io.to(to).emit('call-rejected', {
            from: socket.id,
            message: 'Call was declined'
        });
    });
    
    // Video toggle handler
    socket.on('video-toggle', (data) => {
        const { to, enabled } = data;
        if (to) {
            io.to(to).emit('video-toggle', {
                from: socket.id,
                enabled: enabled
            });
        }
    });
    
    // End call
    socket.on('end-call', (data) => {
        const { to } = data;
        if (to) {
            io.to(to).emit('call-ended', { from: socket.id });
        }
        if (activeCalls.has(socket.id)) {
            const peer = activeCalls.get(socket.id);
            activeCalls.delete(socket.id);
            activeCalls.delete(peer);
        }
    });

    // Group messages
    socket.on('send-group-message', async (data) => {
        try {
            const { groupId, message } = data;
            if (!groupId || !message || !message.text) return;
            const member = await isGroupMember(groupId, socket.userId);
            if (!member) return;
            const saved = await groupDB.addMessage(groupId, socket.userId, message.text);
            const members = await groupDB.getMembers(groupId);
            const payload = {
                id: saved.id,
                author: users.get(socket.id)?.username || 'Unknown',
                avatar: users.get(socket.id)?.avatar || (users.get(socket.id)?.username || 'U')[0],
                text: message.text,
                timestamp: new Date(),
                groupId
            };
            members.forEach(m => {
                const target = Array.from(users.values()).find(u => u.id === m.id);
                if (target) {
                    io.to(target.socketId).emit('group-message', payload);
                }
            });
        } catch (error) {
            console.error('Group message error:', error);
        }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        const user = users.get(socket.id);
        
        if (user) {
            console.log(`${user.username} disconnected`);
            
            // Update status in database
            try {
                await userDB.updateStatus(socket.userId, 'Offline');
            } catch (error) {
                console.error('Error updating status:', error);
            }
            
            rooms.forEach((members, roomName) => {
                if (members.has(socket.id)) {
                    members.delete(socket.id);
                    io.to(`voice-${roomName}`).emit('user-left-voice', socket.id);
                }
            });

            // End direct call if exists
            if (activeCalls.has(socket.id)) {
                const peer = activeCalls.get(socket.id);
                activeCalls.delete(socket.id);
                activeCalls.delete(peer);
                io.to(peer).emit('call-ended', { from: socket.id });
            }
            
            users.delete(socket.id);
            io.emit('user-list-update', Array.from(users.values()));
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Discord Clone server running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/login.html in your browser`);
});
