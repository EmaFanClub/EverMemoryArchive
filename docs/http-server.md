# HTTP Endpoints

You can start an HTTP server using `pnpm dev` (in development mode) or `pnpm build && pnpm start` (in production mode). For the first time running these commands, you need to install the dependencies first by running `pnpm install`.

Before starting the server, you need to create a `.env` file by copying the `.env.example` file and filling in your API keys.

The backend (path that starts with `/api/`) and frontend (other paths) are served on the same port.

Frontend endpoints:

- Visit [http://localhost:3000/](http://localhost:3000/) (or the specific host if you changed it) to start a chat with the actor.

Backend endpoints:

- [Send](./http/actor/input/route/variables/POST) inputs to actors.
- [Subscribe](./http/actor/sse/route/variables/GET) to outputs from actors.
