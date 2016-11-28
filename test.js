var databaseContext = require('./sqlite3-entities');
var context = new databaseContext("test.db", true);

context.table("test_table", {
    id: 0,
    uid: "",
    active: false,
    created: 0
}, {
    uid: { unique: true },
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

    context.test_table.remove((t) => t.uid == "test123", function (deleted) {
        if (deleted) console.log("row removed!");
        context.test_table.add({
            uid: "test123",
            active: true,
            created: 1001
        }, function() {
            console.log("row added!")
        });
    });
});

context.on("error", function(err) {
    console.log(err);
})