# SQLite 3 Async Entities in JavaScript / Node.js
#Installing
##Browser
```html
  <script src="sqlite3-entities.js"></script>
```
##Node.js
###https://www.npmjs.com/package/sqlite3entities
```bash
  npm install sqlite3-entities --save
```
##Source
```bash
  git clone https://github.com/TimothyMeadows/sqlite3-entities
```
#Tables
I felt it was important that tables could be defined in it's simplest form in a standard object notation. While complex mapping / indexing might be needed at a more advanced level. It didn't have to be "in your face" at all times. Types are inferred by there value. However, those values are not actually treated as defaults. This may change in the future. Similar to other ORM / Entity style frameworks. I wanted advanced "mapping" to be handeled in it's own object allowing for table objects, and, matching map objects when needed.

```javascript
  var databaseContext = require('./sqlite3-entities');
  var context = new databaseContext("test.db", true);
  context.table("test_table", {
    id: 0,
    uid: ""
    active: false,
    created: 0
  });
```

Numbers, and, Boolean are treated as INTEGER. String, and, object are treated as TEXT, array is treated as a BLOB. Default for unknown types is BLOB. Should you need. You can override a inferred type for a column using a custom mapping.

```javascript
  var databaseContext = require('./sqlite3-entities');
  var context = new databaseContext("test.db", true);
  context.table("test_table", {
    id: 0,
    uid: ""
    active: false,
    created: 0
  }, {
    active: { type: "TEXT" }
  });
```

The primary key is automatically determined using the first property in the object. You can override this by supplying the property you would like to use as the final parameter in the table method. Type is ignored when using this method. Any property supplied as the primary key will be converted to an auto incrementing INTEGER. If you do not want an auto incrementing primary key you can override this by setting the increment mapping to false.

```javascript
  var databaseContext = require('./sqlite3-entities');
  var context = new databaseContext("test.db", true);
  context.table("test_table", {
    id: 0,
    uid: ""
    active: false,
    created: 0
  }, {
    active: { type: "TEXT" },
    uid: { increment: false }
  }, "uid");
```

Finally, Foreign keys, and, unqiue constraints can be declared using the mapping object. Current direct entity mapping via the table model is not supported. But it will be a future upgrade when time permits.

```javascript
var databaseContext = require('./sqlite3-entities');
var context = new databaseContext("test.db", true);
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
    id: 0
});
```

#Ready & Error
In the unfortunite event an exception occurs. You can use the error event to listen for what occured. More importantly, you will need to listen for the ready event before you can access entities you would like to use. This is due to the pure async nature of the library. Additionally, you can use the migrated, and, created properties to determine if the data was just created, or, migrated and may be in need of seeding.

```javascript
var databaseContext = require('./sqlite3-entities');
var context = new databaseContext("test.db", true);
context.on("ready", function () {
    if (context.migrated) console.log("database was migrated!");
    if (context.created) console.log("database was created!");

    console.log("database is ready!");
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
```

