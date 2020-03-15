const fs = require("fs");
const axios = require("axios");
const path = require("path");

const DB_LOCATION = path.join(__dirname, "db.json");

// official minimum query interval allowed by the API provider. It is set to 5 
// minutes in milliseconds.
const API_MIN_INTERVAL_MS = 1000 * 60 * 5;

/*
  time margin that will be added to the time between requests. As mentioned here 
  https://www.eecis.udel.edu/~ntp/ntpfaq/NTP-s-sw-clocks.htm hardware clocks are 
  not accurate. They can gain an error of ~1 second over the course of one day. 
  The paper mentions Linux machines can have a 11 PPM error rate (part per 
  million, see the paper for an explaination of this measurement unit). I'll 
  round it to 20 PPM and assume a worst case scenario of one party (eg. the app 
  server) being 20 PPM short and the other (eg. their server) 20 PPM over in the 
  5 minutes estimate. We can later add a 40 PPM margin to the API minimum 
  interval so the app is going to avoid being banned due to CPU clock errors.
*/
const CPU_TOLERANCE_MS = (API_MIN_INTERVAL_MS / 1000000) * 40;

// actual wait time for queries in milliseconds, adjusted for CPU clock errors
const WAIT_TIME_MS = API_MIN_INTERVAL_MS + CPU_TOLERANCE_MS;

// assumed max value of time in milliseconds (1 minute) that can occur between 
// the time the query is sent and the moment it is checked for constraint 
// compliance by the API. This is used rarely by the app, only when it does not 
// know the response date for the last query.
const MAX_QUERY_RECEPTION_DELAY_MS = 1000 * 60;

// default database that gets used on first boot or on boot with corrupt 
// database
const DEFAULT_DB = { 
  lastAPIResponseTime: null, 
  lastAPIQueryTime: null
};

async function main(options) { // function invoked by src/start.js on boot
  const db = getDB(DB_LOCATION);
  
  if (db.corrupt) {
    // the app may have previously crashed while writing on db, since we don't 
    // know anything about the dates of the last operations, we wait the assumed 
    // max query reception delay + regular wait time
    await time(MAX_QUERY_RECEPTION_DELAY_MS + WAIT_TIME_MS);
  }
  
  let lastResponse = db.lastAPIResponseTime; // dates are in milliseconds 
  let lastQuery = db.lastAPIQueryTime;       // since 1970/01/01 UTC
  
  let chargingStationStatus = null;
  
  waitAndCall:
  while (true) { // eslint-disable-line no-constant-condition
    await waitBeforePoll(lastResponse, lastQuery);
    
    lastQuery = Date.now(); // take note of the query call time
    setDB(lastResponse, lastQuery);
    
    let res;
    try {
      res = await axios.get(options.url);
      // the app waits for the response of the server to continue the iteration 
      // because a reliable date is needed on which it can start to wait for the 
      // computed time interval to finish (more in the README.md, "Why the app 
      // waits for the server response to start waiting for the next call")
    } catch (error) {
      if (error && error.isAxiosError) {
        lastResponse = Date.now(); // write the response time
        setDB(lastResponse, lastQuery);
        continue waitAndCall;
      } else {
        throw error;
      }
    }
    lastResponse = Date.now(); // write the response time
    setDB(lastResponse, lastQuery);
    
    const status = getStatus(res);
    if (typeof status === "string" && status !== chargingStationStatus) {
      console.log("The charging station is " + status.toLowerCase() + ".");
      chargingStationStatus = status;
    }
  }
  
}

function getStatus(res) {
  if (res && res.data && res.data.evses && res.data.evses[0] && 
    typeof res.data.evses[0].status === "string") {
    return res.data.evses[0].status;
  }
  return null;
}

// this function waits the necessary time according to file constants and API 
// communication dates
async function waitBeforePoll(lastResponse, lastQuery) {
  if (isNumber(lastQuery)) { // app previously polled the API
    if (isNumber(lastResponse)) { // app had at least one API response
      if (lastResponse < lastQuery) {
        /*
         [*]
         app did not get a response for its last query. The app could have been 
         previously terminated while waiting on the response. At this point the 
         app can't know when the API processed the query (worst case) or if the 
         API got the query at all (best case). If the API did not get the query 
         a safe period to query again starts at lastResponse + WAIT_TIME_MS. If 
         the API received the query we assume it happened before 
         lastQuery + MAX_QUERY_RECEPTION_DELAY_MS (NOTE: it's a risky 
         assumption, because we don't actually know for sure how long it will 
         take for the message to reach the API). Therefore in this case a safe 
         period to query again starts at 
         lastQuery + MAX_QUERY_RECEPTION_DELAY_MS + WAIT_TIME_MS. The safest way 
         to deal with these uncertainties is to satisfy the worst case 
         requirements.
        */
        await necessaryTime(
          lastQuery, MAX_QUERY_RECEPTION_DELAY_MS + WAIT_TIME_MS);
      } else {
        await necessaryTime(lastResponse, WAIT_TIME_MS);
      }
    } else {
      // app never got a response since its installation; see block above with 
      // asterisk [*]
      await necessaryTime(
        lastQuery, MAX_QUERY_RECEPTION_DELAY_MS + WAIT_TIME_MS);
    }
  }
}

// this function waits only for the duration of time that has not already passed 
// since waitStartDate
async function necessaryTime(waitStartDate, timeToWait) {
  const timePassed = Date.now() - waitStartDate;
  if (timePassed >= timeToWait) {
    // app does not wait at all if it already waited enough, eg. the 
    // waitStartDate is set to two days ago because the app crashed around that 
    // time and it was rebooted only two days later
    return; 
  }
  await time(timeToWait - timePassed);
}

// the db file will keep all the necessary info so that the API constraint is 
// respected when the app is rebooted too.
function getDB(dbPath) {
  try {
    const db = require(dbPath);
    db.corrupt = false;
    return db;
  } catch (error) {
    if (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        return Object.assign({}, DEFAULT_DB, { corrupt: false });
      } else if (error instanceof SyntaxError) {
        return Object.assign({}, DEFAULT_DB, { corrupt: true });
      }
    }
    throw error;
  }
}

// returns a boolean telling whether value is a number or not, NaN is checked 
// for too, I don't like it to break my programs
function isNumber(value) {
  return typeof value === "number" && value === value;
}

// promisified setTimeout
function time(milliseconds) {
  return new Promise((f) => setTimeout(f, milliseconds));
}

// it writes the last api response and last api query dates on the db
function setDB(lr, lq) {
  const body = {
    lastAPIResponseTime: lr,
    lastAPIQueryTime: lq
  };
  return fs.writeFile(DB_LOCATION, JSON.stringify(body, null, 2), noAction);
}

// this function is used only to silence Node.js in seDB who threatens 
// developers who don't handle async errors, we don't care about 
function noAction() {}


module.exports = {
  main,
  constants: {
    API_MIN_INTERVAL_MS,
    CPU_TOLERANCE_MS,
    WAIT_TIME_MS,
    MAX_QUERY_RECEPTION_DELAY_MS,
    DEFAULT_DB
  },
  getStatus,
  waitBeforePoll,
  getDB,
  isNumber,
  time,
  setDB,
  noAction
};
