const { Client } = require('pg');
const { log } = require('./util');

const dbOptions = {
  host: process.env.RDS_HOSTNAME || process.env.POSTGRES_HOSTNAME,
  user: process.env.RDS_USERNAME || process.env.POSTGRES_USERNAME,
  password: process.env.RDS_PASSWORD || process.env.POSTGRES_PASSWORD,
  port: process.env.RDS_PORT || process.env.POSTGRES_PORT,
  database: process.env.RDS_DB_NAME || process.env.POSTGRES_DBNAME,
};

class DataStore {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    const client = new Client(dbOptions);
    try {
      log(`connecting to DB: ${dbOptions.user}@${dbOptions.host}:${dbOptions.port}/${dbOptions.database}`);
      client.connect();
    } catch (error) {
      log(`could not connect to DB: ${error}`);
    }

    try {
      log('creating table if needed...');
      await client.query(
        `CREATE TABLE IF NOT EXISTS refresh_tokens (
        g_sub VARCHAR(255) PRIMARY KEY,
        refresh_token VARCHAR(512)
        );
        `,
      );
      const result = await client.query(`
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns
        WHERE table_name = 'refresh_tokens';
      `);

      log(`Table schema:\n${JSON.stringify(result.rows, 2)}`);
      this.initialized = true;
    } catch (error) {
      log(`Error creating/checking table: ${error}`);
    }
    client.end();
  }

  async storeToken(gSub, token) {
    if (!this.initialized) await this.init();
    const client = new Client(dbOptions);
    client.connect();
    await client.query(
      `INSERT INTO refresh_tokens(g_sub, refresh_token)
            VALUES ($1, $2)
            ON CONFLICT (g_sub) 
            DO UPDATE SET refresh_token=EXCLUDED.refresh_token`,
      [gSub, token],
    );
    client.end();
    log(`Saved token for gSub ${gSub}`);
  }

  async getToken(gSub) {
    if (!this.initialized) await this.init();

    const client = new Client(dbOptions);
    client.connect();
    const result = await client.query(
      `SELECT * FROM refresh_tokens
      WHERE g_sub=$1`,
      [gSub],
    );

    if (result.rowCount === 0) {
      return null;
    }

    const [firstRow] = result.rows;
    const { refresh_token: refreshToken } = firstRow;
    return refreshToken;
  }
}

exports.DataStore = DataStore;
