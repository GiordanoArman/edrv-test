const fs = require("fs");
const axios = require("axios");
const path = require("path");

// where we can find our database in order to respect efficiently the API constraint even if the app gets rebooted
const DB_LOCATION = path.join(__dirname, "db.json");

// official minimum interval allowed by the API provider. It is set to 5 minutes in milliseconds.
const API_MIN_INTERVAL_MS = 1000 * 60 * 5;

/*
  time margin that will be added to the iteration interval. As mentioned here https://www.eecis.udel.edu/~ntp/ntpfaq/NTP-s-sw-clocks.htm hardware clocks are not accurate. They can gain an error of 1 second over the course of one day. Linux machines can have a 11 PPM error rate (part per million, see the paper for an explaination of this measurement unit). We'll round it to 20 PPM and assume a worst case scenario of one party (eg. our server) being 20 PPM short and the other (eg. their server) 20 PPM over in the 5 minutes estimate. So we need to add a 40 PPM margin to our API minimum interval so we can be sure to avoid being banned due to CPU clock errors.
*/
const CPU_TOLERANCE_MS = (API_MIN_INTERVAL_MS / 1000000) * 40;

// this is the actual interval for our queries in milliseconds
const INTERVAL_MS = API_MIN_INTERVAL_MS + CPU_TOLERANCE_MS;

// this is the assumed max value of time in milliseconds (1 minute) we assume it can take between out data to be sent and received by the API. See the polling flow diagram in README.md for an example situation in which not taking care of network latency can get us banned.
const MAX_NETWORK_LATENCY_MS = 1000 * 60;

// default database that gets used on first boot or on boot with corrupt database
const DEFAULT_DB = { 
  lastAPIResponseTime: null, 
  lastAPIQueryTime: null,
  corrupt: false
};

async function main(options) {
  const db = getDB(DB_LOCATION);
  
  if (db.corrupt) {
    // the app may have previously crashed while writing on db, since we don't know anything about the dates of the last operations, we wait the assumed max network latency + interval
    await time(MAX_NETWORK_LATENCY_MS + INTERVAL_MS);
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
      res = await axios.get(options.url + "fango");
      // we wait for the response of the server to continue our iteration because we need a reliable date on which we can start to wait for the computed time interval to finish (more in the README.md, "Why we wait for the API response")
    } catch (error) {
      console.log("error", error);
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

async function waitBeforePoll(lastResponse, lastQuery) {
  if (isNumber(lastQuery)) { // we previously polled the API
    if (isNumber(lastResponse)) { // we had at least one API response
      if (lastResponse < lastQuery) {
        // [*]
        // we did not get a response for our last query, our app could have been terminated while waiting on the response. At this point we don't know when the API processed our query (worst case) or if the API got our query at all (best case). If the API did not get our query a safe period to query again starts at lastResponse + INTERVAL_MS. If the API got our query we can assume it happened within lastQuery + MAX_NETWORK_LATENCY_MS (although it's risky, because we don't know for sure how long it will take for the message to reach the API). Therefore in this case a safe period to query again starts at lastQuery + MAX_NETWORK_LATENCY_MS + INTERVAL_MS.
        await necessaryTime(lastQuery, MAX_NETWORK_LATENCY_MS + INTERVAL_MS);
      } else {
        await necessaryTime(lastResponse, INTERVAL_MS);
      }
    } else {
      // we never got a response since the installation of this app; see block above with asterisk [*]
      await necessaryTime(lastQuery, MAX_NETWORK_LATENCY_MS + INTERVAL_MS);
    }
  }
}

// this function avoids waiting for time that has already passed
async function necessaryTime(waitStartDate, timeToWait) {
  const timePassed = Date.now() - waitStartDate;
  if (timePassed >= timeToWait) {
    return;
  }
  await time(timeToWait - timePassed);
}

// the db file will keep all the necessary info so that the API constraint is respected when the app is rebooted too.
function getDB(dbPath) {
  try {
    return require(dbPath);
  } catch (error) {
    if (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        return Object.assign({}, DEFAULT_DB);
      } else if (error instanceof SyntaxError) {
        return Object.assign({}, DEFAULT_DB, { corrupt: true });
      }
    }
    throw error;
  }
}

function isNumber(value) {
  return typeof value === "number" && value === value; //NaN check included
}


function time(milliseconds) {
  return new Promise((f) => setTimeout(f, milliseconds));
}

function setDB(lr, lq) {
  const body = {
    lastAPIResponseTime: lr,
    lastAPIQueryTime: lq
  };
  return fs.writeFile(DB_LOCATION, JSON.stringify(body, null, 2), noAction);
}

function noAction() {}


module.exports = {
  main,
  constants: {
    API_MIN_INTERVAL_MS,
    CPU_TOLERANCE_MS,
    INTERVAL_MS,
    MAX_NETWORK_LATENCY_MS,
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
