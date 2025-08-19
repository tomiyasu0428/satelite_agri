# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a farm field management system (圃場データベース) that allows users to draw field boundaries on Google Maps, calculate areas in hectares, and save/manage field data with GeoJSON polygon storage. The system has a hybrid architecture supporting both local table APIs and MongoDB backend.

## Architecture

### Frontend (Static Web App)
- **index.html** - Main application interface with Google Maps integration
- **js/main.js** - Core Google Maps drawing functionality and UI logic
- **js/config.js** - Configuration management with dynamic API key loading
- **js/api.loader.js** - Dynamic API implementation switcher
- **js/api.js** - Local table API implementation (for testing/demo)
- **js/api.external.js** - External backend API implementation (production)

### Backend (Node.js + Express + MongoDB)
- **server.js** - Express server with MongoDB integration, provides REST API for field CRUD operations
- Supports environment-based configuration via `.env` file
- Includes CORS handling and graceful shutdown

### API Architecture
The system uses a configurable API mode (`apiMode` in config.js):
- `'tables'` - Uses local table API (js/api.js)
- `'external'` - Uses MongoDB backend (js/api.external.js)

## Common Development Commands

```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev

# Start production server
npm start

# Serve static frontend (choose one):
python3 -m http.server 8080
npx serve .
```

## Environment Setup

Create `.env` file in project root:
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/Agri-AI-Project
MONGODB_DATABASE=Agri-AI-Project
GOOGLE_MAPS_API_KEY=your_api_key_here
PORT=3000
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080
```

## API Endpoints

Base URL: `http://localhost:3000/api`

- **GET** `/health` - Server health check
- **GET** `/config` - Frontend configuration (API keys)
- **GET** `/fields` - List fields (with pagination: ?page=1&limit=100)
- **POST** `/fields` - Create field
- **PUT** `/fields/:id` - Update field
- **DELETE** `/fields/:id` - Delete field (soft delete)

## Data Model

Fields are stored in MongoDB with this schema:
```javascript
{
  name: String,           // Field name
  crop: String,           // Crop type
  memo: String,           // Notes
  area_ha: Number,        // Area in hectares
  geometry: Object,       // GeoJSON Polygon geometry
  created_at: Date,
  updated_at: Date,
  deleted: Boolean
}
```

Frontend expects `geometry_json` field containing stringified GeoJSON Feature.

## Key Technical Details

- **Google Maps Integration**: Uses Drawing and Geometry libraries for polygon creation and area calculation
- **GeoJSON Format**: Coordinates stored as [longitude, latitude] arrays
- **Area Calculation**: Automatic hectare calculation using Google Maps Geometry API
- **API Switching**: Runtime API implementation switching via config
- **Error Handling**: Comprehensive error handling for MongoDB operations and API requests
- **Security**: Environment-based API key management and CORS configuration

## Development Workflow

1. Backend development: Modify `server.js` and restart with `npm run dev`
2. Frontend development: Edit files in `js/` directory and refresh browser
3. API mode switching: Change `apiMode` in `js/config.js`
4. Database operations: Direct MongoDB queries via connection in `server.js`

## Important Files for Understanding

- `server.js:43-54` - Database connection logic
- `js/main.js:43-50` - Google Maps polygon drawing setup
- `js/config.js:3-9` - API mode configuration
- `js/api.loader.js` - Dynamic API loading mechanism