var databaseContext = require('./sqlite3-entities');
var context = new databaseContext("test.db", { cached: true });

context.table("test_table", {
    id: 0,
    uid: "",
    active: false,
    created: 0
}, {
    uid: { unique: true },
    id2: {foreign:{table:"test_table2", column: "id"}}
});

context.table("test_table2", {
    id: 0,
    uid: ""
});

context.once("ready", function () {
    if (context.migrated) console.log("database was migrated!");
    if (context.created) console.log("database was created!");

    console.log("database is ready!");
    console.log(context);

    context.test_table.remove((t) => t.uid == "test123", function (deleted) {
        if (deleted) console.log("row removed!");
        context.test_table.add({
            uid: "test123",
            active: true,
            created: 1001
        }, function() {
            console.log("row added!");
            context.test_table.where((t) => t.created == 1001 && t.active, function(row) {
                console.log(row);
            })
        });
    });
});

context.once("migration", function(differences) {
    console.log("Table differences");
    console.log(differences);

    var migration = new context.migration();
    for (var i = 0; i <= differences.length - 1; i++) {
        switch (differences[i]) {
            case "test_table2":
                migration.prepare("ALTER TABLE test_table2 ADD uid TEXT;");
                migration.run(function() {
                    migration.accept();
                })
                break;
            default:
                migration.reject();
                break;
        }
    }
});

context.on("error", function(err) {
    console.log(err);
});