const { MongoClient, ServerApiVersion } = require('mongodb');

const dbUser = "cpcamma";
const dbPassword = process.env.DB_1234; // Set this in your terminal or .env file
const dbName = "optometry";
const uri = `mongodb+srv://${dbUser}:${dbPassword}@cluster0.tdvimfl.mongodb.net/${dbName}?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB Atlas optometry DB!");
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
