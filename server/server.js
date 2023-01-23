const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('uuid');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8010;

app.use(
  cors({
    origin: 'https://localhost:53000',
    credentials: true,
  })
);

app.disable('x-powered-by');

app.use(bodyParser.json());

app.listen(port, () => {
  console.log('Server is running on port ' + port + '...');
});

// require('date-format-lite');

// get the client
const mysql = require('mysql2/promise');
const db = mysql.createPool({
  host: process.env.HOST,
  user: process.env.MYSQL_USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE,
});

async function serverConfig() {
  const db = mysql.createPool({
    host: process.env.HOST,
    user: process.env.MYSQL_USER,
    password: process.env.PASSWORD,
    database: process.env.DATABASE,
  });
  // Read
  app.get('/data', async (req, res) => {
    try {
      const results = await Promise.all([
        db.query('SELECT * FROM tasks'),
        db.query('SELECT * FROM dependencies'),
      ]);

      const tasks = results[0][0],
        dependencies = results[1][0];

      res.send({
        success: true,
        tasks: {
          rows: tasks,
        },
        dependencies: {
          rows: dependencies,
        },
      });
    } catch (error) {
      sendResponse(res, 'error', null, error, [], [], [], []);
    }
  });

  // add a new task
  // Create, Update, Delete (Tasks & Dependencies)
  app.post('/api', async function (req, res) {
    let requestId = '';
    let lastKey = '';
    let err = null;

    const taskUpdates = [];
    const tasksRemoved = [];
    const dependencyUpdates = [];
    const dependenciesRemoved = [];

    console.log(
      `\n${req.method} ${req.url} --> ${JSON.stringify(req.body, `\t`, 2)}`
    );

    for (const [key, value] of Object.entries(req.body)) {
      if (key === 'requestId') {
        requestId = value;
      }
      if (key === 'tasks') {
        for (const [key2, value2] of Object.entries(value)) {
          if (key2 === 'added') {
            value2.forEach((addObj) => taskUpdates.push(addObj));
            value2[0].id = uuid.v4();
            const val = await createOperation(value2[0], 'tasks');
            lastKey = val.msg;
            err = val.error;
          }

          if (key2 === 'updated') {
            console.log(`updated tasks...`, value2);
            value2.forEach((updateObj) => taskUpdates.push(updateObj));
            const val = await updateOperation(value2, 'tasks');
            lastKey = val.msg;
            err = val.error;
          }

          if (key2 === 'removed') {
            tasksRemoved.push(value2[0]);
            const val = await deleteOperation(value2[0].id, 'tasks');
            lastKey = val.msg;
            err = val.error;
          }
        }
      }

      if (key === 'dependencies') {
        for (const [key2, value2] of Object.entries(value)) {
          if (key2 === 'added') {
            value2[0].id = uuid.v4();
            value2.forEach((addObj) => dependencyUpdates.push(addObj));
            const val = await createOperation(value2[0], 'dependencies');
            lastKey = val.msg;
            err = val.error;
          }

          if (key2 === 'updated') {
            value2.forEach((updateObj) => dependencyUpdates.push(updateObj));
            const val = await updateOperation(value2, 'dependencies');
            lastKey = val.msg;
            err = val.error;
          }

          if (key2 === 'removed') {
            dependenciesRemoved.push(value2[0]);
            const val = await deleteOperation(value2[0].id, 'dependencies');
            lastKey = val.msg;
            err = val.error;
          }
        }
      }
    }

    sendResponse(
      res,
      lastKey,
      requestId,
      err,
      taskUpdates,
      dependencyUpdates,
      tasksRemoved,
      dependenciesRemoved
    );
  });
}

serverConfig();

function sendResponse(
  res,
  action,
  requestId,
  error,
  taskUpdates,
  dependencyUpdates,
  tasksRemoved,
  dependenciesRemoved
) {
  if (action == 'error') console.log(error);

  const result = {
    success: action === 'error' ? false : true,
  };
  if (requestId !== undefined && requestId !== null)
    result.requestId = requestId;

  // updated tasks
  result.tasks = {};
  result.tasks.rows = [];

  if (taskUpdates.length) {
    result.tasks.rows = [...result.tasks.rows, ...taskUpdates];
  }

  // deleted tasks
  result.tasks.removed = [];

  if (tasksRemoved.length) {
    result.tasks.removed = [...result.tasks.removed, ...tasksRemoved];
  }

  // updated dependencies
  result.dependencies = {};
  result.dependencies.rows = [];

  if (dependencyUpdates.length) {
    result.dependencies.rows = [
      ...result.dependencies.rows,
      ...dependencyUpdates,
    ];
  }

  // deleted dependencies
  result.dependencies.removed = [];

  if (dependenciesRemoved.length) {
    result.dependencies.removed = [
      ...result.dependencies.removed,
      ...dependenciesRemoved,
    ];
  }

  res.send(result);
  return;
}

async function createOperation(addObj, table) {
  const valArr = [];
  const keyArr = [];
  for (const [key, value] of Object.entries(addObj)) {
    if (
      key !== 'baselines' &&
      key !== 'from' &&
      key !== 'to' &&
      key !== '$PhantomId' &&
      key !== 'segments' &&
      key !== 'ignoreResourceCalendar'
    ) {
      keyArr.push(`\`${key}\``);
      valArr.push(value);
    }
  }

  try {
    await db.query(
      `INSERT INTO ${table} (${keyArr.join(', ')}) VALUES (${Array(
        keyArr.length
      )
        .fill('?')
        .join(',')})`,
      valArr
    );
    return { msg: 'added', error: null };
  } catch (error) {
    return { msg: 'error', error: error };
  }
}

async function updateOperation(updates, table) {
  try {
    await Promise.all(
      updates.map(({ id, ...update }) => {
        return db.query(
          `
          UPDATE ${table}
          SET ${Object.keys(update)
            .map((key) => `${key} = ?`)
            .join(', ')}
          WHERE id = ?
        `,
          Object.values(update).concat(id)
        );
      })
    );
    return { msg: 'update', error: null };
  } catch (error) {
    return { msg: 'error', error };
  }
}

async function deleteOperation(id, table) {
  try {
    await db.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
    return { msg: 'deleted', error: null };
  } catch (error) {
    return { msg: 'error', error: error };
  }
}
