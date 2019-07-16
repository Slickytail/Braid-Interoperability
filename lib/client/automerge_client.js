const Automerge = require("automerge")
const random = require("../random")
const pu = require("../patch")

const SERVER_GUID = "SERVER"
class Client {
    constructor(socket) {
        this.uid = random.guid()
        this._bind(socket)
        this.docSet = new Automerge.DocSet()
        this.con = new Automerge.Connection(this.docSet, m => this.socket.send(m))
        
        socket.addEventListener('open', () => {
            setTimeout(() => {
                this.con.open()
                var initmessage = `{"docId": "val", "clock": {"${SERVER_GUID}": 1}}`
                this.socket.onmessage(new MessageEvent("message", {data: initmessage}))
            }, 10)
        })
    }
    _bind(socket) {
        this.socket = socket;
        this.socket.onmessage = m => this.con.receiveMsg(m.data);
    }
    set onOutput(callback) {
        this.docSet.registerHandler((docId, doc) => {
            callback(doc.text.join(''), [], false)
        })
    }

    onedit(patches) {
        var doc = this.docSet.getDoc("val")
        if (doc) {
            doc = Automerge.change(doc, doc => {
                var cursor = 0;
                for (var patch of patches) {
                    if (patch.start > cursor) {
                        cursor = patch.start
                    }
                    if (patch.end > patch.start) {
                        for (var i = 0; i < patch.end - patch.start; i++)
                            doc.text.deleteAt(cursor)
                        cursor = patch.end
                    }
                    if (patch.ins.length) {
                         doc.text.insertAt(cursor, ...patch.ins)
                    }
                }
            })
            this.docSet.setDoc("val", doc)
        }
    }
}

class SocketRewriter extends WebSocket {
    constructor(url) {
        super(url)
        this.clock = []
    }
    
    send(data) {
        console.log(`Trying to send ${JSON.stringify(data)}`)
        var message = this._rewrite_outgoing(data)
        console.log(`Rewrote send to ${JSON.stringify(message)}\n----------------------`)
        message.original_text = data
        super.send(JSON.stringify(message))
    }
    
    set onmessage(handler) {
        super.onmessage = function(e) {
            if (e.data) {
                console.log(`Trying to receive ${e.data}`)
                var m = {data: e.data,
                         origin: e.origin,
                         lastEventId: e.lastEventId, 
                         source: e.source,
                         ports: e.ports
                }
                m.data = this._rewrite_incoming(JSON.parse(m.data))
                console.log(`Rewrote message to ${JSON.stringify(m.data)}\n----------------------`)
                handler(new MessageEvent("message", m))
            }
            else {
                handler(e)
            }
        }
    }
    get onmessage() {
        return super.onmessage
    }
    
    _rewrite_incoming(data) {
        // Passthrough our spoofed init message
        if (data.docId) return data
        var d = {}
        if (data.set) {
            d.docId = "val"
            if (data.patches) {
                var c = this.clock.indexOf(data.version)
                if (c != -1) {
                    // This was a version we sent, it's probably an ack
                    /*d.src = this.uid
                    d.seq = s
                    var v = this.versions.indexOf(data.version) + 1
                    if (v) {
                        d.v = v
                    } else {
                        // Make a new version #?
                        this.versions.push(data.version)
                        d.v = this.versions.length - 1
                    }*/
                } else {
                    // This is a new version.
                    d.op = pu.op_from_patches(data.patches.map(pu.patch_from_json))
                    
                    var v = this.versions.indexOf(data.version) + 1
                    if (v) {
                        throw "We've seen this version before"
                    } else {
                        // Make a new version #?
                        this.versions.push(data.version)
                        d.v = this.versions.length - 1
                    }
                }
                    
            }
            else {
                d.a = "s";
                var v = this.versions.indexOf(data.version) + 1
                if (!v) {
                    this.versions.push(data.version)
                    v = this.versions.length
                }
                d.data = {
                    v: v,
                    data: data.val,
                    type:"http://sharejs.org/types/textv1"
                }
            }
        }
        return d
    }
    _rewrite_outgoing(data) {
        var d = {}
        if (Object.keys(data.clock).length === 0 && data.clock.constructor === Object)
            d = {get: "val"}
        return d
    }
}

module.exports = {Client: Client, Socket: SocketRewriter}