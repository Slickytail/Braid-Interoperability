const clone = require('clone')
const sync9 = require("../sync9")
const random = require("../random")
const pu = require("../patch")
const TransparentSocket = require('./socket')

function arr_to_obj(arr) {
    var obj = {}
    for (var z of arr) {
        obj[z] = true
    }
    return obj
}

class Client {
    constructor(socket) {
        this.server_leaves = {root: true};
        this.state = 'disconnected';
        this.unacked = [];
        this.delete_us = {};
        this.got_first_version = false;
        this.init();
        this._bind(socket);
    }
    _bind(socket) {
        this.socket = socket;
        this.socket.onmessage = m => this._route_incoming_message(JSON.parse(m.data));
        this.socket.addEventListener('open',  () => {this.join()});
    }
    set onOutput(callback) {
        this.output_callback = (patches, local) => callback(this.read(), patches.map(pu.patch_from_json), local);
    }
    init() {
        this.s9 = sync9.create()
        sync9.add_version(this.s9, 'v1', {root: true}, [' = ""'])
        sync9.prune(this.s9, (a, b) => true, (a, b) => true)
        delete this.s9.T.v1
        this.s9.leaves = {root: true}
    }
    
    join() {
        this.state = 'connected';
        this._send_get(Object.keys(this.server_leaves))
        this.unacked.forEach(this._send_version)
    } 
    
    prune() {
        if (Object.keys(this.delete_us).length > 0) {
            var deleted = sync9.prune(this.s9, (a, b) => this.delete_us[b], (a, b) => this.delete_us[a])
            if (!Object.keys(this.delete_us).every(x => deleted[x])) throw 'wtf?'
            if (!Object.keys(deleted).every(x => this.delete_us[x])) throw 'wtf?'
            this.delete_us = {}
        }
    }
    
    add_remote_version(vid, parents, patches) {
        this.prune()
        parents.forEach(p => {
            delete this.server_leaves[p]
        })
        this.server_leaves[vid] = true
        
        if (this.s9.T[vid]) {
            var v = this.unacked.shift()
            if (v.vid != vid) throw 'how?'
            return
        }
        if (!this.got_first_version) {
            this.got_first_version = true
            var save = sync9.read(this.s9)
            this.init()
            sync9.add_version(this.s9, vid, arr_to_obj(parents), patches)

            if (save != sync9.read(this.s9) && save.length) {
                console.log("Rebasing early edits...")
                this.create_version(['[0:0]=' + JSON.stringify(save)])
            }
        } else {
            sync9.add_version(this.s9, vid, arr_to_obj(parents), patches)
        }
        this._send_ack(vid)
        
        if (this.output_callback)
            this.output_callback(patches, false)
    }
    
    ack(vid) {
        // This is when the server sends an ack to tell us to prune something
        this._send_ack(vid)
        if (!this.s9.T[vid]) return
        
        this.delete_us[vid] = true
        
        if (this.server_leaves[vid]) {
            var ancs = sync9.get_ancestors(this.s9, this.server_leaves)
            Object.keys(this.delete_us).forEach(x => {
                delete ancs[x]
            })
            var not_leaves = {}
            Object.keys(ancs).forEach(x => {
                Object.assign(not_leaves, this.s9.T[x])
            })
            this.server_leaves = {}
            Object.keys(ancs).forEach(x => {
                if (!not_leaves[x])
                    this.server_leaves[x] = true
            })
        }
        
        this.unacked = this.unacked.filter(x => x.vid != vid)
    }
    onedit(patches) {
        this.create_version(patches.map(pu.patch_to_json))
        if (this.output_callback)
            this.output_callback(patches.map(pu.patch_to_json), true)
    }
    create_version(patches) {
        var x = {
            vid : random.guid(),
            parents : clone(this.s9.leaves),
            patches : patches
        }
        sync9.add_version(this.s9, x.vid, x.parents, x.patches)
        if (this.got_first_version) {
            this.unacked.push(x)
            this._send_version(x)
        }
        return x
    }
    read() {
        return sync9.read(this.s9)
    }
    _route_incoming_message(message) {
        var type = (message.get && 'get')
                || (message.set && 'set')
                || (message['delete'] && 'delete')
                || (message.forget && 'forget')
                || (message.ack && 'ack')
        switch (type) {
            case 'set':
                this._handle_set(message)
                break
            case 'ack':
                this.ack(message.version)
                break
            default:
                console.error(`Client doesn't know how to handle message of type ${type}`, message)
        }
    }
    _handle_set(message) {
        if (message.val)
            message.patches = `= ${message.val}`
        this.add_remote_version(message.version, message.parents, message.patches)
    }
    _send_version(version) {
        var message = {
            set: "val",
            patches: version.patches,
            parents: Object.keys(version.parents),
            version: version.vid
        }
        this.socket.send(JSON.stringify(message))
    }
    _send_ack(vid) {
        this.socket.send(JSON.stringify({ack: "val", version: vid}))
    }
    _send_get(parents, version) {
        var message = {get: "val"}
        if (parents)
            message.parents = parents
        if (version)
            message.version = version
       this.socket.send(JSON.stringify(message))
    }
   
}
module.exports = {Client: Client, Socket: TransparentSocket}