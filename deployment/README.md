# EverMindAgent Docker Deployment

This directory contains Docker Compose configurations for deploying EverMindAgent.

## Local Development with Docker

### Prerequisites

- Docker
- Docker Compose

### Quick Start

To start the application with MongoDB:

```bash
cd deployment
docker compose -f local.yml up
```

Or from the root directory:

```bash
docker compose -f deployment/local.yml up
```

To run in detached mode:

```bash
docker compose -f deployment/local.yml up -d
```

To view logs:

```bash
docker compose -f deployment/local.yml logs -f
```

To stop the services:

```bash
docker compose -f deployment/local.yml down
```

> **Note**: If you're using an older version of Docker, you may need to use `docker-compose` (with a hyphen) instead of `docker compose`.

### Services

The `local.yml` compose file includes:

- **MongoDB**: Database service running on port 27017
  - Default credentials: `admin/password`
  - Data persisted in Docker volume `mongodb_data`
  
- **App**: Node.js v24 application running the development server
  - Runs `pnpm dev` command
  - Accessible at `http://localhost:3000`
  - Data directory `.data/local-instance` is mapped to container's `.data` directory
  - Source code hot-reloading enabled via volume mounts

### Network

Both services are connected via the `evermindagent-network` bridge network, allowing them to communicate using service names (e.g., the app can connect to MongoDB using `mongodb:27017`).

### Data Persistence

- MongoDB data is stored in the `mongodb_data` Docker volume
- Application data is stored in `.data/local-instance` directory on the host

### Volume Mounts

The compose file mounts several directories for hot-reloading:
- `packages/` - For source code changes
- `node_modules/` - To share dependencies between host and container

**Note:** If you experience performance issues with the `node_modules` mount (especially on Windows or macOS), you can comment out that line in `local.yml` and rebuild the container. The application will still work but you'll need to rebuild the image after dependency changes.

### Environment Variables

The following environment variables are configured for the app service:

- `NODE_ENV=development`
- `MONGODB_URI=mongodb://admin:password@mongodb:27017/evermindagent?authSource=admin`

You can override these by creating a `.env` file or modifying the `local.yml` file.

**Security Note:** The default MongoDB credentials (admin/password) are suitable for local development only. If you expose these services to a network or use this in production, make sure to change the credentials and use proper security measures.

### Troubleshooting

If you encounter permission issues with the `.data/local-instance` directory, ensure it exists and has proper permissions:

```bash
mkdir -p .data/local-instance
chmod -R 755 .data/local-instance
```

To rebuild the application container after code changes:

```bash
docker compose -f deployment/local.yml up --build
```

To clean up all containers, networks, and volumes:

```bash
docker compose -f deployment/local.yml down -v
```
