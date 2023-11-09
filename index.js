require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const admin = require('firebase-admin');
const serviceAccount = require('./general-authentication-f7699-firebase-adminsdk-tw7ov-42be31b655.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'gs://general-authentication-f7699.appspot.com',
});

// Set up the Firebase Storage Bucket
const bucket = admin.storage().bucket();

// Set up multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(
  cors({
    origin: ['http://localhost:5173', 'https://assigneo-akib-saleh.web.app', 'https://assigneo-akib-saleh.firebaseapp.com/'],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const logger = (req, res, next) => {
  console.log('Custom MiddleWare logged');
  next();
};

app.get('/', logger, (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hfh6rjb.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const assignmentCollection = client.db('assigneo').collection('assignments');
    const submissionCollection = client.db('assigneo').collection('submissions');

    app.post('/jwt', async (req, res) => {
      const user = await req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: true,
          sameSite: 'none',
          maxAge: 60 * 60 * 1000,
        })
        .send({ success: true });
    });

    app.post('/logout', async (req, res) => {
      const user = await req.body;
      console.log('got api call from client side', user);
      res.clearCookie('token', { maxAge: 0, secure: true, sameSite: 'none' }).send(user);
    });

    app.post('/assignment', upload.single('thumb'), async (req, res) => {
      const assignment = await req.body;
      const file = req.file;

      if (file) {
        const metadata = {
          metadata: {
            firebaseStorageDownloadTokens: uuidv4(),
          },
          contentType: file.mimetype,
          cacheControl: 'public, max-age=31536000',
        };

        const blob = bucket.file(file.originalname);
        const blobStream = blob.createWriteStream({
          metadata: metadata,
          gzip: true,
        });

        blobStream.on('error', (err) => {
          return res.status(500).send(err);
        });

        blobStream.on('finish', async () => {
          const thumbUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(blob.name)}?alt=media&token=${metadata.metadata.firebaseStorageDownloadTokens}`;

          const assignmentData = { ...assignment, uploadedThumb: thumbUrl };

          const result = await assignmentCollection.insertOne(assignmentData);
          if (result) {
            return res.status(200).send(result);
          }
        });

        blobStream.end(file.buffer);
      } else {
        const result = await assignmentCollection.insertOne(assignment);
        if (result) {
          return res.status(200).send(result);
        }
      }
    });

    app.get('/all-assignment', async (req, res) => {
      const urlQuery = req.query.difficulty;

      if (urlQuery === 'all') {
        const cursor = assignmentCollection.find();
        const result = await cursor.toArray();
        res.send(result);
      } else if (urlQuery === 'Easy' || urlQuery === 'Medium' || urlQuery === 'Hard') {
        const query = { difficulty: urlQuery };
        const cursor = assignmentCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } else {
        // Handle invalid difficulty values
        res.status(400).send('Invalid difficulty value');
      }
    });

    app.get('/assignment/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await assignmentCollection.findOne(query);
      res.send(result);
    });

    app.post('/submissions', async (req, res) => {
      const submission = await req.body;
      const result = await submissionCollection.insertOne(submission);
      if (result) res.send(result);
    });

    app.get('/submissions', async (req, res) => {
      const query = { status: 'pending' };
      const cursor = submissionCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/submission/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await submissionCollection.findOne(query);
      res.send(result);
    });

    app.patch('/submission/:id', async (req, res) => {
      const id = req.params.id;
      const submission = await req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: submission.status,
          feedback: submission.feedback,
          result_marks: submission.result_marks,
        },
      };
      const result = await submissionCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // await client.connect();

    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);
