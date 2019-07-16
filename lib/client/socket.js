
class TransparentSocket extends WebSocket {
    constructor(url) {
        super(url)
    }

    send(data) {
        console.log(`Sending:  ${data}`)
        super.send(data)
    }

    set onmessage(handler) {
        super.onmessage = function(e) {
            if (e.data) console.log(`Received: ${e.data}`)
            handler(e)
        }
    }
    get onmessage() {
        return super.onmessage
    }
}
module.exports = TransparentSocket