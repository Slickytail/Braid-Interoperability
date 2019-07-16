const ShareDB = require('sharedb');
const ShareDBTypes = require("sharedb/lib/types");
const ottext = require('ot-text');

class Server {
    constructor(ready) {
        ShareDBTypes.register(ottext.type)
        this.share = new ShareDB({
            disableDocAction: true,
            disableSpaceDelimitedActions: true});
        var connection = this.share.connect();
        this.doc = connection.get('interoperability', 'val');
        this.doc.subscribe((err) => {
            if (err) throw err;
            if (this.doc.type === null) {
                this.doc.create("", 'text', ready);
            } else
                ready()
        })
    }
    listen(socket) {
        this.share.listen(socket);
    }
}
module.exports = Server