# Use Node.js 18 as a base (LTS)
FROM node:18-slim

# Install build tools and SQLite dependencies using apt-get
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*

# Create app directory in the container
WORKDIR /app

# Copy only package files first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy the rest of the source code
COPY . .

# Expose port 3000 (or whatever port your app uses)
EXPOSE ${PORT}

# By default, run your bot with Node
# (Change "index.js" to the actual name of your main file)
CMD ["node", "index.js"]
