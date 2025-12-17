# Use Node.js v24 as base image
FROM node:24-alpine

# Install pnpm globally
RUN npm install -g pnpm@10.16.1

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages

# Install dependencies
RUN pnpm install --frozen-lockfile

# Expose port 3000 (Next.js default port)
EXPOSE 3000

# Run the development server
CMD ["pnpm", "dev"]
