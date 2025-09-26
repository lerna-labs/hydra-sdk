## Hydra Events Deployment at Rare Evo 2025: A Retrospective**

### Overview

During Rare Evo 2025, we successfully deployed a Hydra head as a real-world
local currency demonstration. Overall, the experience was hugely positive,
especially with a Cardano-savvy crowd and some exciting prizes that got people
engaged.

**Key Challenges**

1. *UTxO Contention:* We learned that using a single master UTxO for all
   transactions led to bottlenecks. The fix? Assigning each user their own UTxO
   to act more like individual accounts, which should prevent that kind of
   contention in the future.

2. *Frequent Restarts Due to Network Hiccups:* Initially, the Hydra head was
   connected over a WAN socket to a remote Cardano node. Even tiny network
   breaks caused restarts that took hours to recover. The solution was running a
   local Cardano node, which virtually eliminated those restarts and sped up any
   necessary replays.

3. *Caching Attendee Balances:* Without a caching layer, we accidentally DDoSed
   ourselves by having every balance request hit the Hydra head directly. The
   plan is to add a caching layer so that we reduce load and keep things running
   smoothly.

### Moving Forward

With these lessons learned, we’re confident that future deployments will be even
more stable and efficient. Thanks for walking through all of this with me—this
draft should give us a great starting point!
