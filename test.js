var databaseContext = require('./sqlite3-entities');
var context = new databaseContext("test.db");

context.table("test_table", {
    id: 0,
    uid: "",
    other_id: 0,
    object: {},
    array: [],
    active: false,
    created: 0
}, {
    uid: { unique: true },
    other_id: { foreign: { table: "test_table2", column: "id" } }
});

context.table("test_table2", {
    id: 0
});

context.on("ready", function () {
    if (context.created) {
        console.log("database was created!");
    }
    
    console.log("database is ready!");
    console.log(context);
});