var entities = require('./sqlite3-entities');
var context = new entities.database("test.db", { cached: true, migration: entities.migration.alter });

var testTable2 = function() {
    this.id = 0;
    this.uid = "";
}

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

context.table("test_table2", new testTable2());

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
                var row = rows.where((t) => t.created == 0).first((t) => t.uid == "test123");
                console.log(row);
                
                row.active = false;
                context.test_table.update(row, (t) => t.uid == "test123", function() {
                    context.test_table.select(["id", "uid", "array", "object", "active"]).first((t) => t.uid == "test123", function (row) {
                        console.log(row);
                    });
                });
            });
        });

        var tt2 = new testTable2();
        tt2.uid = "123water";

        context.test_table2.add(tt2);
    });
});

context.once("migration", function(migration, differences) {
    console.log("manual migration needed!");
    console.log(migration);
    console.log(differences);

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