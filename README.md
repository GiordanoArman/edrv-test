## Why we wait for the server response to start waiting for the next call

In this app I could have just set an interval to do the polling, like this:
   

     setInterval(doThePolling, 1000 * 60 * 5);


but I decided to take another direction. Here I explain why.

Let's examine the polling flow:

 1. Our app sends message through network to their API endpoint.
 2. Their app receives message from network.
 3. Their app computes whether we satisfy the minimum interval constraint.
 4. Their app sends response to network.
 5. Our app receives the response.

Between point A and C there can be variable time spans taken by our requests, depending on the network performance at each of our requests, how much traffic is currently going through their infrastructure and how much their machines are busy handling other tasks. Sending requests at regular intervals with solutions like `setInterval` can cause problems in situations like the following:

 - Our app sends a message at 00:00:00.
 - The network performs poorly, their infrastructure is saturated and their app checks whether we comply with the constraint at 00:00:10 (ten seconds later) and responds at 00:00:11.
 - Our app sends a second message at 00:05:00 (five minutes after our first message was sent).
 - The networks performs better and the infrastructure is freer, so their app checks on our constraint compliance at 00:05:01 (1 second later it was sent). Their app will detect that only 4 minutes and 51 seconds have passed since our initial message. At this point we are banned.
 
 Knowing for certain that the amount of time between point 1 and 3 is always less or equal to the time between point 1 and 5, if we wait for E to happen before setting the next polling call we are sure to avoid the just mentioned banning situation.
