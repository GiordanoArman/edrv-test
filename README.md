# Project overview

This app:

 1. Uses the most efficient way of querying the API which is keeping as near as possible to the 5 minutes minimum interval allowed by the API provider.
 2. Can respect the API constraint if it crashes and is restarted, since it takes note of its operations on a persistent database.
 3. Can operate if the database is corrupt.
 4. Takes into account CPU clock errors and avoids banning due to them.
 5. Takes into account possible network or API infrastructure poor performance during the communication.
 6. Optimizes wait times based on the last response or query dates, on restart too.

## Installation

 1. Make sure you have Node.js v12.14.0 or higher and npm 6.13.4 or higher installed on your machine.
 2. Open a terminal window and `cd` into the project folder.
 3. Run `npm install` and wait for it to complete.

## Running

 1. After installing `cd` into the project folder.
 2. Run `npm run start`.
 
## Codebase overview

All the source files are located in the `src` folder: `index.js` contains all the important logic, `start.js` imports `index.js` and boots the application.

## Why the app waits for the server response to start waiting for the next call

In this app I could have set an interval to do the polling, like this:
   

     setInterval(doThePolling, 1000 * 60 * 5);


but I decided to take another direction. Here I explain why.

Let's examine the polling flow:

 1. Our app sends message through network to their API endpoint.
 2. Their app receives message from network.
 3. Their app computes whether we satisfy the minimum interval constraint.
 4. Their app sends response to network.
 5. Our app receives the response.

Between point 1 and 3 there can be variable time amounts taken by our requests, depending on the network performance, traffic going through their infrastructure and how much their machines are busy handling other tasks at each of our requests. Sending requests at regular intervals with solutions like `setInterval` can cause problems in situations like the following:

 - Our app sends a message at 00:00:00.
 - The network performs poorly, their infrastructure is saturated and their app checks whether we comply with the constraint at 00:00:10 (ten seconds later) and responds at 00:00:11.
 - Our app sends a second message at 00:05:00 (five minutes after our first message was sent).
 - The networks performs better and their infrastructure is less busy, so their app checks on our constraint compliance at 00:05:01 (1 second later it was sent). Their app will detect that only 4 minutes and 51 seconds have passed since our initial message. At this point we are banned.
 
 Knowing for certain that the amount of time between point 1 and 3 is always less or equal to the time between point 1 and 5, if we wait for point 5 (the app gets the response) to happen before setting the wait time for the next polling call we are sure to avoid the just mentioned banning situation.
