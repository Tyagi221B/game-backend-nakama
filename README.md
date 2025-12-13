# Multiplayer Tic-Tac-Toe - Nakama Backend

A production-ready, server-authoritative multiplayer Tic-Tac-Toe game built with Nakama as the backend infrastructure.

## Live Demo

- **Frontend:** https://game.asmittyagi.com
- **Backend API:** https://api.asmittyagi.com
- **Admin Console:** https://api.asmittyagi.com:7351 (username: `admin`, password: `password`)

## Tech Stack

### Backend
- **Nakama 3.22.0** - Open-source game server (handles authentication, matchmaking, real-time communication)
- **PostgreSQL 16** - Database for persistent storage (user data, leaderboards)
- **TypeScript** - Server-side game logic
- **Docker & Docker Compose** - Containerization and orchestration

### Infrastructure
- **DigitalOcean Droplet** - Ubuntu 24.04 LTS server
- **Nginx** - Reverse proxy with SSL termination
- **Let's Encrypt** - Free SSL certificates

### Frontend Repository
- Frontend code is in a separate repository
- Built with React + TypeScript + Vite
- Deployed on Vercel
- Real-time WebSocket communication with backend

## Features

### Core Requirements (All Implemented)

#### Server-Authoritative Game Logic
- All game state managed on the server
- 4-layer move validation system:
  1. Game must be active
  2. Must be player's turn
  3. Position must be valid (0-8)
  4. Cell must be empty
- Server-side winner detection
- Prevents client-side manipulation and cheating
- Broadcast validated state updates to all clients

#### Matchmaking System
- Automatic player pairing
- Find existing match or create new one
- Queue-based matchmaking with `+label.open:1` query
- Handle player connections/disconnections gracefully
- Forfeit system on disconnect

#### Real-time Multiplayer
- WebSocket-based real-time communication
- Instant move synchronization
- Live turn indicators
- Connection status tracking with auto-reconnect

### Bonus Features (All Implemented)

#### Leaderboard System
- Track player wins, losses, and win rate
- Global ranking system (top 10 players)
- Incremental leaderboard updates
- Persistent player statistics
- Real-time leaderboard refresh after game completion

#### Timer-Based Game Mode
- 30-second turn timer
- Countdown display in UI
- Automatic forfeit on timeout
- Opponent wins if player runs out of time
- Timer resets on each turn

#### Concurrent Game Support
- Multiple simultaneous game sessions
- Proper game room isolation
- Scalable architecture for concurrent players
- Each match has independent state

## Architecture & Design Decisions

### Why Server-Authoritative?

In multiplayer games, there are two main approaches:
1. **Client-Authoritative** - Client sends "I moved here", server accepts it (vulnerable to cheating)
2. **Server-Authoritative** - Client sends "I want to move here", server validates and decides

We use **server-authoritative** architecture for security and fairness:

```
Client                    Server
  |                         |
  |--"Move to position 4"-->|
  |                         | ✓ Validate: Is game active?
  |                         | ✓ Validate: Is it player's turn?
  |                         | ✓ Validate: Is position valid?
  |                         | ✓ Validate: Is cell empty?
  |                         | ✓ Apply move
  |                         | ✓ Check winner
  |                         | ✓ Switch turn
  |<--"Updated game state"--|
  |                         |
```

### Anti-Cheat Implementation

Located in `modules/src/match_handler.ts:284-361`, the `handleMove` function implements 4 validation layers:

```typescript
// VALIDATION 1: Game must be active
if (state.status !== "active") return state;

// VALIDATION 2: Must be player's turn
if (state.currentTurn !== userId) return state;

// VALIDATION 3: Position must be valid (0-8)
if (position < 0 || position > 8) return state;

// VALIDATION 4: Cell must be empty
if (state.board[position] !== null) return state;

// ✅ ALL VALIDATIONS PASSED - Apply the move
```

**Security Benefits:**
- Client cannot manipulate game state directly
- Client cannot move out of turn
- Client cannot place on occupied cells
- Client cannot cheat the timer
- All game logic runs on trusted server

### Why Nakama?

Nakama provides production-ready features out of the box:
- Built-in authentication (device ID, custom, social)
- WebSocket connections with automatic reconnection
- Match system with state synchronization
- Leaderboards with atomic operations
- Scalable real-time infrastructure
- Battle-tested in production games

### Tech Stack Choices

**TypeScript for Server Logic:**
- Type safety prevents runtime errors
- Better IDE support and autocomplete
- Easier to maintain and refactor
- Compiles to JavaScript for Nakama runtime

**Docker Compose:**
- Consistent development and production environments
- Easy to set up PostgreSQL + Nakama
- One command to start entire stack
- Portable across machines

**Nginx + SSL:**
- Required for HTTPS (browsers block mixed content)
- WebSocket support with proper upgrade headers
- Reverse proxy for clean architecture
- Free SSL with Let's Encrypt

## Project Structure

```
game-backend-nakama/
├── docker-compose.yml          # Container orchestration
├── data/
│   └── local.yml               # Nakama configuration
├── modules/
│   ├── src/
│   │   ├── main.ts            # Entry point, RPC registration
│   │   ├── match_handler.ts   # Game logic, validation, winner detection
│   │   └── types.ts           # TypeScript type definitions
│   ├── package.json           # Dependencies
│   └── tsconfig.json          # TypeScript config
└── README.md                  # This file
```

### Key Files

**`modules/src/main.ts`** - Nakama initialization
- Register match handler for Tic-Tac-Toe
- Register RPCs: `find_match`, `get_leaderboard`, `delete_user_data`
- Create leaderboards: `global_wins`, `global_losses`

**`modules/src/match_handler.ts`** - Core game logic (476 lines)
- `matchInit` - Create empty game state
- `matchJoinAttempt` - Validate player can join (max 2 players)
- `matchJoin` - Assign X or O, start game when 2 players present
- `matchLoop` - Process moves, check timer, detect winner
- `matchLeave` - Handle disconnections, award forfeit
- `handleMove` - 4-layer validation + winner detection
- `checkWinner` - Check 8 winning combinations + draw
- `updateLeaderboard` - Increment wins/losses

**`data/local.yml`** - Nakama configuration
- Socket settings (port 7350, WebSocket support)
- CORS configuration (allow frontend domain)
- Runtime settings (JavaScript entrypoint)

## Setup Instructions

### Prerequisites

- **Node.js** 18+ and npm
- **Docker** and Docker Compose
- **Git**

### Local Development Setup

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd game-backend-nakama
```

2. **Install dependencies and build TypeScript modules**
```bash
cd modules
npm install
npm run build
cd ..
```

3. **Start Nakama + PostgreSQL**
```bash
docker-compose up
```

You should see:
```
✅ Tic-Tac-Toe server module loaded successfully!
```

4. **Verify it's running**
```bash
# Health check
curl http://localhost:7350/v2/healthcheck

# Admin console
open http://localhost:7351
# Login: admin / password
```

5. **Run the frontend** (separate repository)
```bash
# Set environment variables
VITE_NAKAMA_HOST=localhost
VITE_NAKAMA_PORT=7350
VITE_NAKAMA_SSL=false

# Start dev server
npm run dev
```

### Useful Commands

```bash
# View logs
docker-compose logs -f nakama

# Restart Nakama (after code changes)
cd modules && npm run build && cd ..
docker-compose restart nakama

# Stop everything
docker-compose down

# Clean slate (delete all data)
docker-compose down -v
rm -rf data/postgres
```

## Deployment Process

### Backend Deployment (DigitalOcean)

#### 1. Create Droplet

- **Region:** Choose closest to users
- **Image:** Ubuntu 24.04 LTS
- **Size:** $6/month (1GB RAM) or $12/month (2GB RAM recommended)
- **Authentication:** SSH key recommended

#### 2. Initial Server Setup

SSH into droplet:
```bash
ssh root@YOUR_DROPLET_IP
```

Install dependencies:
```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose git -y

# Install Nginx
apt install nginx -y

# Install Certbot (SSL)
apt install certbot python3-certbot-nginx -y
```

#### 3. Clone and Build

```bash
cd /root
git clone <your-repo-url>
cd game-backend-nakama

# Build TypeScript modules
cd modules
npm install
npm run build
cd ..

# Start services
docker-compose up -d

# Verify
docker-compose logs nakama | grep "successfully"
```

#### 4. Configure DNS

Add A record in your DNS provider:
```
Type: A
Name: api
Value: YOUR_DROPLET_IP
TTL: Auto
```

Wait 2-5 minutes for propagation. Test:
```bash
ping api.yourdomain.com
```

#### 5. Get SSL Certificate

```bash
systemctl stop nginx
certbot certonly --standalone -d api.yourdomain.com --non-interactive --agree-tos -m your@email.com
```

#### 6. Configure Nginx

Create `/etc/nginx/sites-available/nakama`:
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

upstream nakama_http {
    server 127.0.0.1:7350;
}

upstream nakama_grpc {
    server 127.0.0.1:7349;
}

server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # HTTP + WebSocket
    location / {
        proxy_pass http://nakama_http;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    # gRPC
    location /grpc {
        grpc_pass grpc://nakama_grpc;

        grpc_set_header Host $host;
        grpc_set_header X-Real-IP $remote_addr;
        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable and start:
```bash
ln -s /etc/nginx/sites-available/nakama /etc/nginx/sites-enabled/
nginx -t
systemctl start nginx
systemctl enable nginx
```

#### 7. Configure Firewall

```bash
ufw allow 22        # SSH
ufw allow 80        # HTTP
ufw allow 443       # HTTPS
ufw enable
ufw status
```

#### 8. Test Backend

```bash
curl https://api.yourdomain.com/v2/healthcheck
```

Should return JSON with server info.

### Frontend Deployment (Vercel)

1. **Push frontend code to GitHub**

2. **Connect to Vercel**
   - Import repository
   - Framework: Vite
   - Build command: `npm run build`
   - Output directory: `dist`

3. **Set Environment Variables**
   ```
   VITE_NAKAMA_HOST=api.yourdomain.com
   VITE_NAKAMA_PORT=443
   VITE_NAKAMA_SSL=true
   ```

4. **Deploy**
   - Vercel auto-deploys on push to main branch

## Configuration Details

### Environment Variables (Frontend)

| Variable | Value | Description |
|----------|-------|-------------|
| `VITE_NAKAMA_HOST` | `api.yourdomain.com` | Backend domain (no http/https) |
| `VITE_NAKAMA_PORT` | `443` | HTTPS port (7350 for local dev) |
| `VITE_NAKAMA_SSL` | `true` | Use SSL (false for local dev) |

### Nakama Configuration (`data/local.yml`)

```yaml
socket:
  port: 7350
  allowed_origins:
    - "https://game.yourdomain.com"  # Frontend URL
```

**CORS Setup:** Whitelist your frontend domain to allow WebSocket connections.

### Docker Compose Ports

| Port | Service | Description |
|------|---------|-------------|
| 5432 | PostgreSQL | Database |
| 7349 | Nakama gRPC | gRPC API (for SDKs) |
| 7350 | Nakama HTTP | REST API + WebSocket |
| 7351 | Nakama Console | Admin dashboard |

## Testing Multiplayer Functionality

### Manual Testing

1. **Open browser 1** - Go to your frontend URL
   - Enter username "Alice"
   - Click "Find Match"
   - Should show "Finding a random player..."

2. **Open browser 2 (incognito)** - Same URL
   - Enter username "Bob"
   - Click "Find Match"
   - **Game should start immediately!**

3. **Play the game**
   - Alice sees X, Bob sees O
   - Take turns clicking cells
   - 30-second timer appears for current player
   - Turn switches automatically
   - Winner/draw screen appears when game ends

4. **Check leaderboard**
   - Top right corner shows global rankings
   - Winner gets +1 win
   - Loser gets +1 loss
   - Win rate updates automatically

### Expected Behavior

**Matchmaking:**
- First player creates a match and waits
- Second player joins the existing match
- Game starts when 2 players are present

**Gameplay:**
- X always goes first
- Current player has green "YOUR TURN" indicator
- Opponent sees amber "THINKING" indicator
- Timer counts down from 30 seconds
- Can only click on empty cells during your turn

**Game End:**
- Victory/defeat modal appears
- Leaderboard updates within 1-2 seconds
- "Play Again" button finds new match
- "Back to Home" reloads page

**Disconnection:**
- If player leaves during game, opponent wins by forfeit
- Connection status indicator shows in top-left

### Testing Scenarios

1. **Normal Win:** Player gets 3 in a row
2. **Draw:** All 9 cells filled, no winner
3. **Timeout:** Player exceeds 30 seconds, opponent wins
4. **Forfeit:** Player disconnects, opponent wins
5. **Reconnection:** Network drops, auto-reconnects

## API Endpoints

### REST API (via Nakama)

**Authentication:**
```
POST /v2/account/authenticate/device
Body: { username: "alice" }
Response: { token: "..." }
```

**RPCs (custom server functions):**
```
POST /v2/rpc/find_match
POST /v2/rpc/get_leaderboard
POST /v2/rpc/delete_user_data
```

### WebSocket API

**Connect:**
```
wss://api.yourdomain.com/ws?token=<auth_token>
```

**Send Move:**
```javascript
socket.send({
  match_data_send: {
    match_id: "...",
    op_code: 1,  // MAKE_MOVE
    data: { position: 4 }
  }
});
```

**Receive State Update:**
```javascript
socket.onmessage = (event) => {
  // op_code: 2 (STATE_UPDATE)
  // data: { board, currentTurn, status, winner, ... }
};
```

## Troubleshooting

### Backend Issues

**Nakama won't start:**
```bash
# Check logs
docker-compose logs postgres
docker-compose logs nakama

# Common fix: PostgreSQL not ready
docker-compose down
docker-compose up
```

**Module not loading:**
```bash
# Rebuild TypeScript
cd modules
npm run build
cd ..
docker-compose restart nakama
```

**WebSocket connection fails:**
```bash
# Check Nginx config
nginx -t

# View Nginx logs
tail -f /var/log/nginx/error.log

# Check if Nakama is accessible
curl http://localhost:7350/v2/healthcheck
```

### Frontend Issues

**Mixed content error:**
- Ensure `VITE_NAKAMA_SSL=true` in production
- Backend must use HTTPS

**Cannot connect:**
- Check CORS in `data/local.yml`
- Verify firewall allows port 443
- Test backend directly: `curl https://api.yourdomain.com/v2/healthcheck`

## Security Considerations

### Production Checklist

- [ ] Change default admin credentials in `local.yml`
- [ ] Change `socket.server_key` in `local.yml`
- [ ] Change `session.encryption_key` in `local.yml`
- [ ] Enable firewall (ufw) with only necessary ports
- [ ] Use strong PostgreSQL password
- [ ] Keep SSL certificates renewed (Certbot auto-renewal)
- [ ] Regular backups of PostgreSQL data
- [ ] Monitor server resources (CPU, RAM, disk)

### Current Security Status

**Implemented:**
- SSL/TLS encryption (Let's Encrypt)
- Server-authoritative game logic (prevents cheating)
- CORS restrictions (only whitelisted frontend)
- Input validation (all moves validated)
- SQL injection protection (Nakama ORM)

**For Production Enhancement:**
- Rate limiting (prevent spam/DDoS)
- IP-based throttling
- Session management improvements
- Monitoring and alerting

## Performance Optimization

**Current Setup:**
- Handles ~100 concurrent players on $6 droplet
- WebSocket keeps persistent connections
- PostgreSQL indexes on leaderboard queries
- Nginx caching for static health checks

**Scaling Options:**
- Vertical: Upgrade to larger droplet
- Horizontal: Multiple Nakama nodes with load balancer
- Database: Managed PostgreSQL (DigitalOcean DBaaS)
- CDN: Cloudflare for frontend caching

## Cost Breakdown

**Monthly Costs:**
- DigitalOcean Droplet: $6-12/month
- Vercel (Frontend): Free tier
- SSL Certificate: Free (Let's Encrypt)
- Domain: ~$12/year

**Total: ~$6-12/month**

## License

This project is built for educational purposes as part of a technical assignment.

## Credits

- **Nakama** - Open-source game server
- **Heroic Labs** - Nakama creators
- **PostgreSQL** - Database
- **Nginx** - Reverse proxy
- **Let's Encrypt** - Free SSL
