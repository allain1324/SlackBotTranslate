// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'slack-translate-bot',
      script: 'index.js',
      // You can also load from a .env file if you prefer:
      // env_file: '.env',
      // Watch restart if files change (useful for dev):
      watch: false,
    },
  ],
};
