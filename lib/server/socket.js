const WebSocketJSONStream = require('@teamwork/websocket-json-stream');
class TransparentJSONSocket extends WebSocketJSONStream {
    constructor(url) {
        super(url)
    }

    write(data) {
        console.log(`Sending:  ${JSON.stringify(data)}`)
        super.write(data)
    }
    on(type, handler) {
        var handler2 = handler;
        if (type == 'data') {
            handler2 = (data) => {
                console.log(`Received: ${JSON.stringify(data)}`)
                handler(data)
            }
        }
        super.on(type, handler2)
    }
}
module.exports = TransparentJSONSocket;