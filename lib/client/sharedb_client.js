const ShareDBClient = require('sharedb/lib/client');
const ShareDBTypes = require("sharedb/lib/types");
const ottext = require('ot-text');
const random = require('../random');
const pu = require("../patch")

class Client {
    constructor(socket) {
        ShareDBTypes.register(ottext.type)
        
        this.uid = random.guid()
        this.socket = socket;
        socket.uid = this.uid;
        var connection = new ShareDBClient.Connection(this.socket)
        this.doc = connection.get('interoperability', 'val')
        this.doc.subscribe(() => {if (this.output_callback) this.output_callback(this.doc.data, [])});
        
        if (this.socket instanceof SocketRewriter) {
            this.socket.addEventListener('open', () => {
                setTimeout(() => {
                    var initmessage = `{"a":"init","protocol":1,"id":"${this.uid}","type":"http://sharejs.org/types/JSONv0"}`
                    this.socket.onmessage(new MessageEvent("message", {data: initmessage}))
                }, 10)
            })
        }   
        connection.on('error', (err) => {
            console.error(err);
        })
    }
    
    /**
     * @param {(text, patches, source) => void} callback
     */
    set onOutput(callback) {
        this.output_callback = callback;
        this.doc.on('op',  (op, source, err) => {
            if (err) {
                console.error(err)
            }
            // Translate an op to patches
            var patches = pu.op_to_patches(op)
            callback(this.doc.data, patches, source);

            if (!source &&
                !this.doc.pendingOps.length &&
                !this.doc.inflightOp &&
                this.doc.data &&
                this.socket.server_text &&
                this.socket.server_text != this.doc.data) {
                console.warn("We might have desynced (new remote): we have", JSON.stringify(this.doc.data),
                    "but server has", JSON.stringify(this.socket.server_text)) 
                global.sync(false);
            }
            else if (!source &&
                !this.doc.pendingOps.length &&
                !this.doc.inflightOp &&
                this.doc.data &&
                this.socket.server_text &&
                this.socket.server_text == this.doc.data) {
                console.log("In sync (new remote)!")
                global.sync(true);
            }
        })
    }
    
    onedit(changes) {
        this.doc.submitOp(pu.op_from_patches(changes), (err) => {
            if (err)
                console.error(err)
            else if (this.doc.data &&
                     this.socket.server_text &&
                     this.socket.server_text != this.doc.data) {
                console.warn("We might have desynced (after ack): we have", JSON.stringify(this.doc.data),
                             "but server has", JSON.stringify(this.socket.server_text))
                global.sync(false);
                }
            else if (this.doc.data &&
            this.socket.server_text &&
            this.socket.server_text == this.doc.data) {
                console.log("In sync (after ack)!")
                global.sync(true);
            }
        })
    }
    
}

class SocketRewriter extends WebSocket {
    constructor(url) {
        super(url)
        this.versions = []
        this.seq = []
        this.timedag = new OPTimeDag();
    }
    
    send(data) {
        console.log(`Sending:    ${data}`)
        var message = this._rewrite_outgoing(JSON.parse(data))
        console.log(`Rewrote to: ${JSON.stringify(message)}`, " \n ")
        message.original_text = data
        if (message.op == []) {
            debugger;
        }
        super.send(JSON.stringify(message))
    }
    
    set onmessage(handler) {
        super.onmessage = function(e) {
            if (e.data) {
                var m = {data: e.data,
                         origin: e.origin,
                         lastEventId: e.lastEventId, 
                         source: e.source,
                         ports: e.ports
                }
                m.data = JSON.stringify(this._rewrite_incoming(JSON.parse(m.data)))
                if (m.data != "{}") {
                    console.log(`Receieved:  ${e.data}`)
                    console.log(`Rewrote to: ${m.data}`, " \n ")
                    handler(new MessageEvent("message", m))
                } else if (!"ack" in JSON.parse(e.data))
                    console.log(`Supressed untranslated message: ${e.data}`, " \n ")
            }
            else {
                handler(e)
            }
        }
    }
    get onmessage() {
        return super.onmessage
    }

    _rewrite_incoming_op(data, d) {
        d.op = pu.op_from_patches(data.patches.map(pu.patch_from_json))
        var s = this.seq.indexOf(data.version)
        var v = this.versions.indexOf(data.version) + 1
        if (s != -1) {
            // This was a version we sent, it's probably an ack
            d.src = this.uid
            d.seq = s;
            if (v) 
                console.warn("Got a local version we'd seen -- probably a snapshot, but let's avoid those")
            else {
                this.timedag.add_op(data.version, data.parents, d.op)
                d.v = this.versions.length
                this.versions.push(data.version)
            }
        } else {
            // Remote version
            if (v)
                console.warn("Got a remote version we'd seen -- probably a snapshot, but let's avoid those")
            else {
                // Now we'll do fucky dag stuff
                // Check if data.parents != timedag.leaves, up to reordering
                if (!this.timedag.set_eq(new Set(data.parents), this.timedag.leaves)) {
                    // Check if data can be transformed without inverses or TP2 to be linearized.
                    // This is the very simple case where we don't want to know anything about
                    // the way that the time dag was linearized.
                    // In other words, we have:
                    //     P
                    //    / \
                    //   D   X_1
                    //        \
                    //         X_2
                    //          \
                    //          ...
                    //            \
                    //             L
                    if (this.timedag.leaves.size == 1 &&
                        this.timedag.only_child(Array.from(this.timedag.leaves)[0], data.parents)) {
                            console.log(`Transforming version ${data.version}`);
                            // Get the sequence of parents from data.parent --> leaves.
                            // Then transform the op against each of them.
                            var parents = [Array.from(this.timedag.leaves)[0]]
                            var p = this.timedag.parents(parents[parents.length - 1])
                            while(p.indexOf(data.parents[0]) == -1) {
                                parents = parents.concat(p)
                                p = this.timedag.parents(p)
                            }
                            parents = parents.reverse().map(i => {return {op: this.timedag.changes(i)}})
                            for (var p of parents) {
                                transformX(d, p)
                            }
                    }
                    else {
                        console.warn(`Potentially impossible transformation required: \n`,
                        `Tried to add version ${data.version} with parents ${data.parents}, \n`,
                        `and current leaves ${Array.from(this.timedag.leaves)}`)
                    }
                }
                // else
                // Nothing needs to be done because data.parents == timedag.leaves
                this.timedag.add_op(data.version, data.parents, d.op);
                d.v = this.versions.length;
                this.versions.push(data.version);
            }
        }
    }
    _rewrite_outgoing_op(data, d) {
        d.set = data.d
        if (data.v > this.versions.length)
            throw "Weird parent version?"
        var p = pu.op_to_patches(data.op)
        d.patches = p.map(pu.patch_to_json)
        
        d.parents = Array.from(this.timedag.leaves)
        d.version = `${this.uid}-${data.seq}`
        this.seq[data.seq] = d.version

        //this.timedag.add_op(d.version, d.parents, data.op)
        
    }

    /* Rewrite Braid mesasges to ShareDB */
    _rewrite_incoming(data) {
        // Don't rewrite fake shareDB messages
        if (data.a) return data
        var d = {}
        if (data.set) {
            d.c = "interoperability"
            d.d = data.set
            if (data.patches) {
                d.a = "op"
                this._rewrite_incoming_op(data, d)
            }
            else {
                if (this.expecting) {
                    d.a = this.expecting;
                    this.expecting = null;
                } else
                    d.a = 's';
                var v = this.versions.indexOf(data.version) + 1
                if (!v) {
                    for (var p of data.parents) {
                        if (!this.timedag.has(p))
                            this.timedag.add_op(p, [], [])
                    }
                    this.timedag.add_op(data.version, data.parents, [`= ${data.val}`])
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
        if ('server_text' in data)
            this.server_text = data.server_text
        return d
    }
    /* Rewrite ShareDB messages to Braid */
    _rewrite_outgoing(data) {
        var d = {}
        if (data.a == 's' || data.a == 'f') {
            d.get = data.d;
            this.expecting = data.a;
        }
        if (data.a == 'f')
            d.version = this.leaf
        if (data.a == 'op')
            this._rewrite_outgoing_op(data, d)
        return d
    }
}

// Transform server op data by a client op, and vice versa. Ops are edited in place.
function transformX(client, server) {
    var type = ottext.type
    if (type.transformX) {
      var result = type.transformX(client.op, server.op);
      client.op = result[0];
      server.op = result[1];
    } else {
      var clientOp = type.transform(client.op, server.op, 'left');
      var serverOp = type.transform(server.op, client.op, 'right');
      client.op = clientOp;
      server.op = serverOp;
    }
};

class OPTimeDag {
    constructor() {
        this._dag = {}
        this._ops = {}
        this.leaves = new Set()
    }

    is_anc(child, anc) {
        return this.parents(child).some(p => {p == anc || this.is_anc(p, anc)})
    }
    add_op(vid, parents, op) {
        if (this.has(vid)) throw `Can't add pre-existing op ${vid}`
        if (!parents.every(p => this.has(p))) {
            global.sync(false);
            console.error(`Got a version with unknown parents: ${parents}->${vid}`)
        }
        this._dag[vid] = parents
        this._ops[vid] = op
        // Update leaves
        this.leaves.add(vid)
        parents.forEach(p => {this.leaves.delete(p)})
    }
    parents(vid) {
        if (this.has(vid))
            return this._dag[vid]
    }
    changes(vid) {
        if (this.has(vid))
            return this._ops[vid]
    }
    has(vid) {
        if (this._ops.hasOwnProperty(vid) != this._dag.hasOwnProperty(vid)) throw "OPs and Parents desynced?"
        return this._ops.hasOwnProperty(vid)
    }
    only_child(child, ancs) {
        var ancs_set = new Set(ancs);
        var only_parent = (c) => {
            var p = this.parents(c);
            if (this.set_eq(new Set(p), ancs_set))
                return true;
            if (p.length != 1)
                return false;
            return only_parent(p[0]);
        }
        return only_parent(child);
    }
    set_eq(A, B) {
        if (A.size != B.size) return false;
        for (var a of A) if (!B.has(a)) return false;
        return true;
    }
}

module.exports = {Client: Client, Socket: SocketRewriter}