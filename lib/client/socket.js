
class TransparentSocket extends WebSocket {
    constructor(url) {
        super(url)
    }

    send(data) {
        
        if (this.console)
            this.console(data, null, true)
        else
            console.log(`Sending:  ${data}`)
        super.send(data)
    }

    set onmessage(handler) {
        super.onmessage = function(e) {
            if (e.data) {
                if (this.console)
                    this.console(e.data, null, false)
                else
                    console.log(`Received: ${e.data}`)
                
            }
            handler(e)
        }
    }
    get onmessage() {
        return super.onmessage
    }
}
module.exports = TransparentSocket