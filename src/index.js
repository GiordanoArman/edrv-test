const fs = require("fs");
const axios = require("axios");
const path = require("path");

//  ITERATION_INTERVAL_MS - it's the minimum allowed interval allowed by
//  the API provider. It is set to 5 minutes in milliseconds.
const API_MIN_INTERVAL_MS = 1000 * 60 * 5;

/*
  CPU_TOLERANCE_MS: a time margin that will be added to the 
  iteration interval. As mentioned here:
  
  https://www.eecis.udel.edu/~ntp/ntpfaq/NTP-s-sw-clocks.htm
  
  === BEGIN QUOTE ===  
    Unfortunately all the common clock hardware is not very accurate. This is 
    simply because the frequency that makes time increase is never exactly right. 
    Even an error of only 0.001% would make a clock be off by almost one second 
    per day. This is also a reason why discussing clock problems uses very fine 
    measures: One PPM (Part Per Million) is 0.0001% (1E-6).

    Real clocks have a frequency error of several PPM quite frequently. Some of 
    the best clocks available still have errors of about 1E-8 PPM (For one of the 
    clocks that is behind the German DCF77 the stability is told to be 1.5 ns/day 
    (1.7E-8 PPM).
  === END QUOTE ===
  
  
  Therefore there may be differences in the actual physical time the API 
  provider's CPUs and our CPUs estimate as 5 minutes. To provide the fastest 
  response rate to the user and avoid banning at all costs we need to add a 
  tolerance to our polling interval.
  
  
  === BEGIN QUOTE ===
    In my experiments with PCs running Linux I found out that the frequency of 
    the oscillator's correction value increases by about 11 PPM after powering 
    up the system.
  === END QUOTE ===
  
  
  Since the estimate is not scientific, we'll round the assumed error our CPUs and the API provider's CPUs are capable of to 20 PPM.
  At this point the worst case scenario is when one of the
  parties is 20 PPM lower than the actual time and the other party is 20 PPM higher the actual time. Therefore the estimated maximum error is 40 PPM. 
  CPU_TOLERANCE_MS is assigned the 40 PPM error based on the official 5 minutes interval limit.
*/
const CPU_TOLERANCE_MS = (API_MIN_INTERVAL_MS / 1000000) * 40;


// this is the actual interval for our queries in milliseconds
const INTERVAL_MS = API_MIN_INTERVAL_MS + CPU_TOLERANCE_MS;

// this is the max value of time in milliseconds (1 minute) we assume it will
// take between out data to be sent and received by the API. It's set to a very
// high value so we are sure to not get banned, ever.
const ASSUMED_MAX_NETWORK_LATENCY_MS = 1000 * 60;


const INTERVAL_WITH_ASSUMED_MAX_NW_LATENCY_MS = 
  INTERVAL_MS + ASSUMED_MAX_NETWORK_LATENCY_MS;

/*
  Why we wait for the server response to start our countdown to the next call
  instead of just setting an interval like this:
  
  setInterval(doThePolling, INTERVAL_MS);
  
  
  Let's examine the polling flow:
  
    A. Our app sends message through network to their API endpoint
    B. Their app receives message from network
    C. Their app computes whether we satisfy the minimum interval constraint
    D. Their app sends response to network
    E. Our app receives the response
  
  Between point A and B there can be variable time spans taken by our requests, depending on the network performance at each of our requests. Sending requests at regular intervals can cause problems in situations like the following (times used are arbitrary):
  
    1. Our app sends a message at 00:00:00
    2. The network performs poorly and their app receives a message at 
       00:00:10 (ten seconds later) and responds at 00:00:11
    3. Our app sends a message at time 00:05:00 (five minutes after our first 
       message)
    4. The networks performs better and their app receives a message at
       00:05:01 (1 second later it was sent). Their app will detect that only 
       4 minutes and 51 seconds have passed since our initial message, at this
       point we are banned).
   
   Assuming the time between A and B is less or equal to the time between A and E (as there is no way for us to understand the occurrence time of operation C), if we wait for E to happen before setting the next polling call we are sure to avoid the above described banning situation.
*/
const DEFAULT_CONFIG = { lastAPIResponseTime: null, lastAPIQueryTime: null };
module.exports = async function(options) {
  // The configuration file will keep all the necessary info so that the API 
  // constraint is respected on app reboot too.
  let config;
  let configCorruptOnStartup = false;
  try {
    config = require("./config.json");
  } catch (error) {
    console.log("require error", error);
    if (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        config = DEFAULT_CONFIG;
      } else if (error instanceof SyntaxError) {
        configCorruptOnStartup = true;
        config = DEFAULT_CONFIG;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
  
  if (configCorruptOnStartup) {
    // the app may have crashed right while writing on config, since we don't know anything about the time information at that point we wait the full interval + the assumed max network latency
    await time(INTERVAL_WITH_ASSUMED_MAX_NW_LATENCY_MS);
  }
  
  // date in milliseconds of last response we got from the API
  let lastResponse = config.lastAPIResponseTime;
  // date in milliseconds of the last GET request to the API
  let lastQuery = config.lastAPIQueryTime;
  
  let chargingStationStatus = null;
  
  waitAndCall:
  while (true) {
    console.log("lastAPIResponseTime", lastResponse);
    console.log("lastAPIQueryTime", lastQuery);
    
    if (typeof lastQuery === "number") { 
      // we previously polled the API
      console.log("we previously polled the API");
      if (typeof lastResponse === "number") {
        // we had at least one API response
        console.log("we had at least one API response");
        if (lastResponse < lastQuery) {
          // we didn't get a response for our last query, this part is the most delicate because we don't have a response date that tells us that the API aknowledged our request, we only have the date of our last query. At this point we can only guess that the API backend processed our request within lastQuery date and lastQuery date + ASSUMED_MAX_NETWORK_LATENCY_MS
          console.log("we didn't get a response to our last query", INTERVAL_MS);
          const timePassed = Date.now() - lastQuery;
          if (timePassed < INTERVAL_WITH_ASSUMED_MAX_NW_LATENCY_MS) {
            await time(INTERVAL_WITH_ASSUMED_MAX_NW_LATENCY_MS - timePassed);
          }
        } else {
          const timePassed = Date.now() - lastResponse;
          if (timePassed < INTERVAL_MS) {
            // we cut short the waiting as some time has already passed
            console.log("we cut short the waiting", INTERVAL_MS - timePassed);
            await time(INTERVAL_MS - timePassed);
          }
        }
      } else { // we never got a response at all
        console.log("we never got a response at all", INTERVAL_MS);
        const timePassed = Date.now() - lastQuery;
        if (timePassed < INTERVAL_WITH_ASSUMED_MAX_NW_LATENCY_MS) {
          await time(INTERVAL_WITH_ASSUMED_MAX_NW_LATENCY_MS - timePassed);
        }
      }
    }
    
    // write the query call time
    console.log("write the query call time");
    lastQuery = Date.now();
    setConfig(lastResponse, lastQuery);
    
    console.log("perform the query", lastQuery);
    let response; // perform the query
    try {
      response = await axios.get(options.url);
    } catch (error) {
      if (error && error.isAxiosError) {
        console.log("error, write the response time", error);
        lastResponse = Date.now(); // write the response time
        setConfig(lastResponse, lastQuery);
        continue waitAndCall;
      } else {
        throw error;
      }
    }
    console.log("write the response time");
    lastResponse = Date.now(); // write the response time
    setConfig(lastResponse, lastQuery);
    
    console.log("response.data", response.data);
  }
  
};

function time(milliseconds) {
  return new Promise((f) => setTimeout(f, milliseconds));
}

function setConfig(lr, lq) {
  const location = path.join(__dirname, "config.json");
  const body = {
    lastAPIResponseTime: lr,
    lastAPIQueryTime: lq
  };
  const noAction = () => {};
  return fs.writeFile(location, JSON.stringify(body, null, 2), noAction);
}
