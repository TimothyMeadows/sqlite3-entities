var databaseContext = require('./sqlite3-entities');
var context = new databaseContext("test.db", { cached: true, autoMigration: 3 });

context.table("test_table", {
    id: 0,
    uid: "",
    array: [],
    object: {},
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
            array: ["test1", 1, "test2", true],
            object: { bird:"raven", loves:"sloths" },
            created: 1001
        }, function() {
            console.log("row added!");
            context.test_table.select(["id", "uid", "array", "object", "active"]).where((t) => t.active, function(rows) {
                console.log(rows.first((t) => t.uid == "test123" && t.created == 0));
            });
        });
    });
});

context.once("migration", function(differences) {
    console.log("Table differences");
    console.log(differences);

    var migration = new context.migration();
    for (var i = 0; i <= differences.length - 1; i++) {
        switch (differences[i].name) {
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