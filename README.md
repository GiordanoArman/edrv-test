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
