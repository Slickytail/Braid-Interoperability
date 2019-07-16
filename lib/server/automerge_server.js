module.exports = create_server
var Automerge = require("automerge")

function create_server(c_funcs, s_text) {
    var s = {}
    
    var root = Automerge.init()
    s.a = Automerge.change(root, doc => {
        doc.text = new Automerge.Text()
        doc.text.insertAt(0, ...s_text)
    })
    s.init_changes = Automerge.getChanges(root, s.a)

    s.peers = {}
    
    s.join = (uid) => {
        var p = s.peers[uid]
        if (!p) s.peers[uid] = p = {}
        p.online = true
    }

    s.add_version = (uid, changes) => {
        s.a = Automerge.applyChanges(s.a, changes)
        Object.entries(s.peers).forEach(x => {
            if (x[0] != uid && x[1].online) {
                c_funcs.add_version(x[0], changes)
            }
        })
    }
    
    s.leave = (uid) => {
        var p = s.peers[uid]
        if (p) p.online = false
    }
    
    s.read = () => s.a.text.join('')
    
    return s
}
    