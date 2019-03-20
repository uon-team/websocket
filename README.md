# UON WebSocket

Websocket server and client implementation for node. 

## Installation

```shell
    npm i @uon/websocket
```

## Usage
To start using @uon/websocket, include it in your app module's imports alongside HttpModule.

```typescript
import { HttpModule } from '@uon/http';
import { WebSocketModule } from '@uon/websocket';

@Module({
    imports: [
        HttpModule.WithConfig({
            plainPort: 8080
        }),
        WebSocketModule
    ]
})
export class MyAppModule {}
```

### Routing upgrade requests

```typescript

import { RouterOutlet } from '@uon/router';
import { HttpRoute, HttpContext } from '@uon/http';

@RouterOutlet()
export class MyAppOutlet {

    constructor(private context: HttpContext) {}

    @HttpRoute({
        method: 'UPGRADE', // <-- Special method for protocol upgrade requests
        path: '/my-ws-channel'
    })
    upgradeToWs() {

        // do the protocol upgrade
        let ws = await this.context.upgrade(WebSocket, {
            'X-My-Extra-Header': '1234' // <-- extra headers to send with upgrade response
        });

        // send and receive
        await ws.send('Hello');

        ws.on('message', (msg: Buffer) => {
            ws.send('Well received.');
        });


    }

}
```


Read more on routing [here](https://github.com/uon-team/router#uon-router).
