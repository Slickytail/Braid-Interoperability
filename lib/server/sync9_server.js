var clone = require('clone')
var sync9 = require("../sync9")
var random = require("../random")

function arr_to_obj(arr) {
    var obj = {}
    for (var z of arr) {
        obj[z] = true
    }
    return obj
}
class Server {
    
    constructor(ready, config) {
        
        this.peers = {}
        this.prune_info = {
            root: {sent: {}, acked: {}},
            v1: {sent: {}, acked: {}}
        }
        this.s9 = sync9.create()
        sync9.add_version(this.s9, 'v1', {root : true}, [` = ""`])
        
        this.config = {prune: true, prune_freq: 5}
        if (config && config.prune == false)
            this.config.prune = false
        if (config && config.prune_freq)
            this.config.prune_freq = config.prune_freq
        this.p_counter = 0

        if (ready)
            ready()
    }
    
    count_prune() {
        this.p_counter = (this.p_counter + 1) % this.config.prune_freq
        if (this.p_counter == 0)
            this.prune()
    }
    prune() {
        if (!this.config.prune) return
        //console.log("Trying to prune...")
        var q = (a, b) => (a != 'root') && !this.s9.leaves[b] && Object.keys(this.prune_info[a].sent).every(x => this.prune_info[b].acked[x])
        
        var s_clone = clone(this.s9)
        var deleted = sync9.prune2(s_clone, q, q)
        
        if (Object.keys(deleted).length == 0)
            return
        
        while (Object.keys(deleted).length > 0) {
            s_clone = clone(this.s9)
            var deleted2 = sync9.prune2(s_clone, (a, b) => q(a, b) && deleted[b], (a, b) => q(a, b) && deleted[a])
            
            if (Object.keys(deleted).some(x => !deleted2[x])) {
                deleted = deleted2
            } else {
                break
            }
        }
        if (Object.keys(deleted).length == 0)
            return

        var backup_parents = {}
        Object.keys(deleted).forEach(x => backup_parents[x] = this.s9.T[x])
        
        deleted2 = sync9.prune2(this.s9, (a, b) => q(a, b) && deleted[b], (a, b) => q(a, b) && deleted[a])
        
        if (Object.keys(deleted).some(x => !deleted2[x]) || Object.keys(deleted2).some(x => !deleted[x])) {
            throw 'wtf?'
        }
        
        Object.keys(deleted).forEach(deleted => {
            Object.entries(this.peers).forEach(x => {
                if (this.prune_info[deleted].sent[x[0]]) {
                    this.peers[x[0]].unacked_prunes[deleted] = backup_parents[deleted]
                }
                if (x[1].online) {
                    this.send_ack(x[0], deleted)
                }
            })
            
            delete this.prune_info[deleted]
        })
        //console.log(`Pruned ${Object.keys(deleted).length} versions`)
    }
    
    create_version(patches) {
        var vid = random.guid()
        if (this.config.prune) this.prune_info[vid] = {sent: {}, acked: {}}
        var parents = clone(this.s9.leaves);
        sync9.add_version(this.s9, vid, parents, patches)
        Object.entries(this.peers).forEach(x => {
            if (x[1].online && x[1].subscribed) {
                this._send_version_diff(x[0], {vid: vid, parents: parents, patches: patches})
                if (this.config.prune) this.prune_info[vid].sent[x[0]] = true
            }
        })
    }
    
    add_remote_version(uid, version) {
        if (this.s9.T[version.version]) {
            console.log(`Got version ${version.version}, which we already had`)
            return
        }
        var t = sync9.read(this.s9)
        var vid = version.version
        var p = this.peers[uid]
        if (this.config.prune) this.prune_info[vid] = {sent: {}, acked: {[uid]: true}}
        
        /*Object.keys(version.parents).forEach(x => {
            if (p.unacked_prunes[x]) {
                throw "Parent was deleted but client hadn't acknowledged that delete yet"
                delete version.parents[x]
                function helper(x) {
                    Object.keys(p.unacked_prunes[x]).forEach(x => {
                        if (p.unacked_prunes[x]) helper(x)
                        else version.parents[x] = true
                    })
                }
                helper(x)
            }
        })*/
        sync9.add_version(this.s9, vid, version.parents, version.patches)
        var nt = sync9.read(this.s9)
        if (nt == t && version.patches.length) {
            console.error("Patch didn't apply?", JSON.stringify(version))
            console.log(`Current text: ${JSON.stringify(sync9.read(this.s9))}`)
        }
        Object.entries(this.peers).forEach(x => {
            if (x[1].online && x[1].subscribed) {
                this._send_version_diff(x[0], version)
                if (this.config.prune) this.prune_info[vid].sent[x[0]] = true
            }
        })
        
        if (this.config.prune) {
            var ancs = sync9.get_ancestors(this.s9, version.parents)
            Object.keys(ancs).forEach(x => {
                var pi = this.prune_info[x]
                if (pi) pi.acked[uid] = true
            })
        }
        this.count_prune()
    }
    
    ack(uid, vid) {
        if (!this.config.prune) return
        var p = this.peers[uid]
        if (p.unacked_prunes[vid]) {
            delete p.unacked_prunes[vid]
            return
        }
        this.prune_info[vid].acked[uid] = true
        if (Object.keys(this.prune_info[vid].sent).every(x => this.prune_info[vid].acked[x])) {
            // We've met the prune conditions
            this.count_prune()
        }
        
    }
    send_ack(uid, vid) {
        var message = {ack: "val", version: vid}
        this._route_outgoing_message(message, uid)
    }
    
    _leave(uid) {
        console.log(`Client ${uid} disconnected`)
        delete this.peers[uid]
    }
    
    listen(stream) {
        // Generate a new uid
        var uid = random.guid()
        this.peers[uid] = {unacked_prunes: {}, online:true, stream: stream}
        var p = this.peers[uid]
        // Listen to the new data with `on('data')`
        console.log("Adding new client")
        p.stream.on('data', message => this._route_incoming_message(message, uid))
        
        p.stream.on('end', () => this._leave(uid));
        p.stream.on('close', () => this._leave(uid));
    }
    
    _route_incoming_message(message, uid) {
        var type = (message.get && 'get')
                || (message.set && 'set')
                || (message['delete'] && 'delete')
                || (message.forget && 'forget')
                || (message.ack && 'ack');
        //if (type != 'ack')
        //    console.log(`Got ${type=='ack' ? 'an' : 'a'} ${type} message from ${uid}`)
        switch (type) {
            case 'get':
                this._handle_get(message, uid)
                break
            case 'set':
                this._handle_set(message, uid)
                break
            case 'forget':
                
                break
            case 'delete':
                
                break
            case 'ack':
                this.ack(uid, message.version);
                break
            default:
                console.warn(`Server doesn't know how to handle message of type ${type} from client ${uid}:`, message)
        }
    }
    
    _handle_get(message, uid) {
        var p = this.peers[uid]
        /* Four cases
        No parents, no version: Retrieve text of latest version, subscribe;
        Parents, no version: Retrieve latest verson as a diff, subscribe;
        No parents, version: Retrieve text of certain version;
        Parents, version: Retrieve certain version as a diff.
        */
        
        if (!message.parents) {
            if (Object.keys(this.s9.leaves).length == 1) {
                this._send_version_data(uid, Object.keys(this.s9.leaves)[0])
            } else {
                console.warn("Sending potentially complete history")
                message.parents = ["root"]
                this._send_version_data(uid, "root")
            }
        }
        if (message.parents && !message.version){
            // We want to return as a diff
            // We need to return everything since those parents
            var ancs = {}
            var mark_ancs = vid => {
                if (!ancs[vid]) {
                    ancs[vid] = true
                    Object.keys(this.s9.T[vid] || p.unacked_prunes[vid]).forEach(k => mark_ancs(k))
                }
            }
            message.parents.forEach(k => mark_ancs(k))
            
            sync9.extract_versions(this.s9, x => ancs[x], x => true).forEach(x => {
                this._send_version_diff(uid, x)
                if (this.config.prune) this.prune_info[x.vid].sent[uid] = true
            })
        }
        
        if (!message.version)
            p.subscribed = true
    }
    _handle_set(message, uid) {
        var m2 = clone(message)
        m2.parents = arr_to_obj(m2.parents)
        this.add_remote_version(uid, m2)
    }
    _send_version_diff(destination, v) {
        if (v.vid)
            v.version = v.vid
        var message = {
            set: "val",
            parents: Object.keys(v.parents),
            version: v.version,
            patches: v.patches
        }
        this._route_outgoing_message(message, destination)
    }
    _send_version_data(destination, vid) {
        var message = {
            set: "val",
            val: sync9.read(this.s9),
            version: vid,
            parents: Object.keys(this.s9.T[vid])
        }
        if (vid == "root")
            message.val = ""
        this._route_outgoing_message(message, destination)
    }
    _route_outgoing_message(message, destination) {
        var p = this.peers[destination]
        if (!p) {
            console.trace(`Server tried to send a version to unknown client ${destination}`)
            return
        }
        message.server_text = sync9.read(this.s9)
        p.stream.write(message)
    }
}
module.exports = Server