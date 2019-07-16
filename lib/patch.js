module.exports = {
    myers_to_patches: myers_to_patches,
    patch_from_json: patch_from_json,
    patch_to_json: patch_to_json,
    transform_cursor: transform_cursor,
    op_to_patches: op_to_patches,
    op_from_patches: op_from_patches,
}

function myers_to_patches(diff) {
    var cursor = 0;
    var patch = [];
    for (var i = 0; i < diff.length; i++) {
        var change = diff[i];
        // Unchanged means move cursor
        if (change[0] == 0)
            cursor += change[1].length;
        // Deleted
        else if (change[0] == -1) {
            var del = cursor + change[1].length;
            // Delete and then insert
            if (i+1 < diff.length && diff[i+1][0] == 1)
                patch.push({start: cursor, end: del, ins: diff[++i][1]})
            // Just delete
            else 
                patch.push({start: cursor, end: del, ins: ""});
            cursor = del;
        }
        // Just insert
        else if (change[0] == 1) {
            patch.push({start: cursor, end: cursor, ins: change[1]})
        }
    }
    return patch;
}

function patch_from_json(json) {
    var ret = {};
    
    var re = /(?:\[(\d+):(\d+)\])?\s*=\s*(.*)/g;
    var m = re.exec(json)
    if (!m || !m[1] || !m[2] || !m[3]) {
        console.error(json)
        throw "Got bad patch JSON"
    }
    ret.start = JSON.parse(m[1]);
    ret.end = JSON.parse(m[2]);
    ret.ins = JSON.parse(m[3]);
    return ret;
}
function patch_to_json(patch) {
    return `[${patch.start}:${patch.end}] = ${JSON.stringify(patch.ins)}`
}

function transform_cursor(cursor, patches) {
    for (var patch of patches) {
        var cstart = patch.start;
        var cend = patch.end;
        var add_size = patch.ins.length - (cend - cstart);
        if (cursor >= cstart)
            cursor += add_size;
    }
    return cursor;
}

function op_to_patches(op) {
    var cursor = 0;
    var patches = []
    for (var i = 0; i < op.length; i++) {
        var change = op[i];
        // Unchanged means move cursor
        if (typeof(change) == "number")
            cursor += change;
        // Deleted
        else if (typeof(change) == "object") {
            var del = cursor + change.d
            // Delete and then insert
            if (i+1 < op.length && typeof(op[i+1]) == "string")
                patches.push({start: cursor, end: del, ins: op[++i]})
            // Just delete
            else
                patches.push({start: cursor, end: del, ins: ""})
            cursor = del;
        }
        // Just insert
        else if (typeof(change) == "string") {
            patches.push({start: cursor, end: cursor, ins: change})
        }
    }
    return patches
}

function op_from_patches(patches) {
    var op = []
    var cursor = 0;
    for (var patch of patches) {
        if (patch.start > cursor) {
            op.push(patch.start - cursor)
            cursor = patch.start
        }
        if (patch.end > patch.start) {
            op.push({d: patch.end - patch.start})
            cursor = patch.end
        }
        if (patch.ins.length) {
            op.push(patch.ins)
        }
    }
    return op
}