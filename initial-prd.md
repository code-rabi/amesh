So I want this folder to become a new project. 

I draw heavy inspiration from https://github.com/formulahendry/acp-ui

But what I had in mind for a POC. 

1. A Server that can register agents, and be a connector between nodes, this can also host the web ui (can be vite or next js or tanstack, but most support socket communication
2. A node - a websocket process in a server/computer, that allow to communicate with agents (there can be multiple agents on a node)


The TLDR for the product - 

I can add multiple nodes and register agents, best would be a single command on the node (with the server address for the registration) adds a node, and from there we can add agents (which are essentially acp commands) like Claude, Codex, OpenClaw, Hermes or any other ACP supporting agent (best would be to use something like acpx https://github.com/openclaw/acpx) 

In the dashboard UI (and server of course) I want to support which agent can trigger another agent. 

So for example I can define

1 Node which is a small 16GB machine with OpenClaw (registered as a node + agent) 
1 Node which is a 34GB machine that has claude and codex (registered as a node + agents)

I then define in the UI that OpenClaw can trigger the claude and codex instances, then I talk to OpenClaw - it can actually trigger Claude and Codex, I thought as if they're local ACPs on their own (and the communication is actually being transmitted over WebSocket via our Server to the other nodes which are triggered) 

Another thing I want is being able to chat in the web UI with any agent in the mash. For the web-ui choose something I would be able to later render in https://zero-native.dev/app-model 


So I want you to create a new design doc, new private repository, then 1 epic for the MVP and split GH issues linked to that epic. 