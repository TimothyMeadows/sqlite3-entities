var sqlite3 = require('sqlite3').verbose(),
    events = require('events'),
    util = require('util'),
    Blackfeather = require('Blackfeather');

var sqlite3Context = function (connectionString, cached) {
    var sqlite3Context = this;
    var database = this.database = cached == true ? new sqlite3.cached.Database(connectionString) : new sqlite3.Database(connectionString);
    var seeder = [];
    var tables = [];

    var migrationPlan = this.migrationPlan = {
        HaltOnChange: 0,
        CreateOnChange: 1,
        AlterOnChange: 2
    };
    var migration = this.migration = migrationPlan.HaltOnChange;
    var created = this.created = false;
    var migrated = this.migrated = false;

    var seed = function () {
        seeder.push(database.prepare("DROP TABLE IF EXISTS 'entities_master'"));
        seeder.push(database.prepare("CREATE TABLE IF NOT EXISTS 'entities_master' (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL)"));
        for (var t in tables) {
            var tableObject = tables[t];
            seeder.push(database.prepare("DROP TABLE IF EXISTS '" + tableObject.name + "'"));
            seeder.push(database.prepare(createTable(tableObject)));
        }

        ensure(seeder, 0, function () {
            delete sqlite3Context.seeder;

            var query = database.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'");
            query.all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);
                for (var i in rows) {
                    if (rows[i].name == "sqlite_sequence" || rows[i].name == "entities_master") {
                        continue;
                    }

                    var hmac = new Blackfeather.Security.Cryptology.Hmac().Compute("table_hash", rows[i].sql);
                    database.prepare("INSERT INTO 'entities_master' (name, hash, salt) VALUES (?, ?, ?)", rows[i].name, hmac.Data.toString(), hmac.Salt).run();
                }

                sqlite3Context.created = true;
                createMappings();
            });
        });
    };

    var table = this.table = function (name, model, mapping, primary) {
        var tableObject = { name: name, scheme: model };
        if (mapping) {
            tableObject.mapping = mapping;
        }

        if (primary) {
            tableObject.primary = primary;
        }

        tables.push(tableObject);
    }

    var createTable = function (tableModel) {
        if (!tableModel["name"] || !tableModel["scheme"]) throw "Invalid table model!"

        var inferType = function (value) {
            if (typeof value == "boolean") return "INTEGER";
            if (/^-?[\d.]+(?:e-?\d+)?$/.test(value)) return "INTEGER";
            if (typeof value == "string") return "TEXT";
            if (typeof value == "object") return "TEXT";
            if (typeof value == "array") return "TEXT";
            return "BLOB";
        }

        var createTableProperty = function (name, value, mapping) {
            var property = name + " ";
            if (mapping) {
                if (mapping["type"]) {
                    property += mapping.type;
                } else {
                    property += inferType(value);
                }

                if (mapping["null"]) {
                    if (mapping.null == false) {
                        property += " NOT NULL";
                    }
                }
            } else {
                property += inferType(value);
            }

            return property;
        };

        var sql = "CREATE TABLE IF NOT EXISTS '" + tableModel.name + "' (";
        var constraints = "";
        var first = true;
        for (var property in tableModel.scheme) {
            if (tableModel["primary"]) {
                if (property == tableModel.primary) {
                    if (first) {
                        sql += createTableProperty(property, tableModel.scheme[property], mapping);
                        first = false;
                    } else {
                        sql += ", " + createTableProperty(property, tableModel.scheme[property], mapping);
                    }

                    sql += " PRIMARY KEY AUTOINCREMENT NOT NULL";
                    continue;
                }
            } else {
                if (first) {
                    sql += createTableProperty(property, tableModel.scheme[property], mapping) + " PRIMARY KEY AUTOINCREMENT NOT NULL";
                    first = false;
                    continue;
                }
            }

            if (tableModel["mapping"]) {
                var mapping = null;

                for (var m in tableModel.mapping) {
                    if (m == property) mapping = tableModel.mapping[m];
                }

                if (first) {
                    sql += createTableProperty(property, tableModel.scheme[property], mapping);
                    first = false;
                } else {
                    sql += ", " + createTableProperty(property, tableModel.scheme[property], mapping);
                }

                if (mapping && mapping["unique"]) {
                    if (constraints == "") {
                        constraints += " CONSTRAINT " + property + "_unique UNIQUE (" + property + ")";
                    } else {
                        constraints += ", CONSTRAINT " + property + "_unique UNIQUE (" + property + ")";
                    }
                }

                if (mapping && mapping["foreign"]) {
                    if (constraints == "") {
                        constraints += " FOREIGN KEY(" + property + ") REFERENCES " + mapping.foreign.table + "(" + mapping.foreign.column + ")";
                    } else {
                        constraints += ", FOREIGN KEY(" + property + ") REFERENCES " + mapping.foreign.table + "(" + mapping.foreign.column + ")";
                    }
                }
                continue;
            }

            if (first) {
                sql += createTableProperty(property, tableModel.scheme[property]);
                first = false;
            } else {
                sql += ", " + createTableProperty(property, tableModel.scheme[property]);
            }
        }

        if (constraints) {
            sql += "," + constraints;
        }

        return sql + ")";
    };

    var createMappings = function () {
        var query = database.prepare("SELECT name FROM sqlite_master WHERE type='table'");
        query.all(function (err, rows) {
            if (err) sqlite3Context.emit("error", err);
            for (var i in rows) {
                if (rows[i].name == "sqlite_sequence" || rows[i].name == "entities_master") {
                    continue;
                }

                sqlite3Context[rows[i].name] = new sqlite3Entity(rows[i].name);
            }

            sqlite3Context.emit("ready");
        });
    };

    var tableExists = this.tableExists = function (tableName, callback) {
        var query = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?", tableName);
        query.all(function (err, row) {
            if (err) sqlite3Context.emit("error", err);
            if (!row || !row[0] || !row[0].name) {
                if (callback) callback(false);
                return;
            }

            if (callback) callback(row[0].name == tableName);
        });
    };

    var ensure = this.ensure = function (chain, index, callback) {
        if (index == chain.length) {
            if (callback) callback();
            return;
        }

        chain[index].run().finalize(function (err) {
            if (err) sqlite3Context.emit("error", err);
            ensure(chain, index + 1, callback);
        });
    }

    var sqlite3Entity = function (tableName) {
        var add = this.add = function (row, callback) {
            var columns = "";
            var values = "";
            var value = [];

            for (var column in row) {
                if (columns == "") {
                    columns = column;
                    values = "?";
                } else {
                    columns += ", " + column;
                    values += ", ?";
                }

                value.push(row[column]);
            }

            database.prepare("INSERT INTO '" + tableName + "' (" + columns + ") VALUES (" + values + ")").run(value, function (err) {
                if (err) sqlite3Context.emit("error", err);
                if (callback) callback();
            });
        }

        var remove = this.remove = function (condition, callback) {
            database.prepare("SELECT * FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var conditioned = false;
                for (var i in rows) {
                    if (condition(rows[i])) {
                        conditioned = true;
                        var clause = "";
                        for (var n in rows[i]) {
                            if (clause == "") {
                                clause = n + " = '" + rows[i][n] + "'"
                            } else {
                                clause += " AND " + n + " = '" + rows[i][n] + "'";
                            }
                        }

                        database.prepare("DELETE FROM '" + tableName + "' WHERE " + clause).run(function (err) {
                            if (err) sqlite3Context.emit("error", err);
                            if (callback) callback(true);
                        });
                    }
                }

                if (!conditioned) {
                    if (callback) callback(false);
                }
            });
        }

        var first = this.first = function (condition, callback) {
            database.prepare("SELECT * FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var conditioned = false;
                for (var i in rows) {
                    if (condition(rows[i])) {
                        conditioned = true;
                        if (callback) callback(rows[i]);
                        break;
                    }
                }

                if (!conditioned) {
                    if (callback) callback(null);
                }
            });
        }

        var last = this.last = function (condition, callback) {
            database.prepare("SELECT * FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var list = [];
                for (var i in rows) {
                    if (condition(rows[i])) {
                        list.push(rows[i]);
                    }
                }

                if (callback) callback(list[list.length]);
            });
        }

        var where = this.where = function (condition, callback) {
            database.prepare("SELECT * FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var list = [];
                for (var i in rows) {
                    if (condition(rows[i])) {
                        list.push(rows[i]);
                    }
                }

                if (callback) callback(list);
            });
        }

        var count = this.count = function (condition, callback) {
            database.prepare("SELECT * FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var index = 0;
                for (var i in rows) {
                    if (condition(rows[i])) {
                        index++;
                    }
                }

                if (callback) callback(index);
            });
        }

        var all = this.all = function (callback) {
            database.prepare("SELECT * FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);
                if (callback) callback(rows);
            });
        };

        var only = this.only = function (columns, callback) {
            database.prepare("SELECT " + columns + " FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);
                if (callback) callback(rows);
            });
        };
    }

    var migrate = function () {
        var physicalMigrationValid = false;
        var objectMigrationValid = false;

        var comparePhysicalMigration = function (callback) {
            var query = database.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'");
            query.all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var validated = 0;
                var migrationNeeded = false;
                for (var i in rows) {
                    var tableRow = rows[i];
                    if (tableRow.name == "sqlite_sequence" || tableRow.name == "entities_master") {
                        continue;
                    }

                    compareMaster(tableRow.name, tableRow.sql, function (valid) {
                        validated++;
                        if (!valid) migrationNeeded = true;
                        if (validated + 2 == rows.length) if (callback) callback(!migrationNeeded);
                    });
                }
            });
        };

        var compareModelMigration = function (callback) {
            var validated = 0;
            var migrationNeeded = false;

            for (var i = 0; i <= tables.length - 1; i++) {
                var tableObject = tables[i];
                var sql = createTable(tableObject);
                sql = sql.replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE"); // TODO: Dirty, fix this! SQLite 3 ommits the IF NOT EXISTS part in master

                compareMaster(tableObject.name, sql, function (valid) {
                    validated++;
                    if (!valid) migrationNeeded = true;
                    if (validated == tables.length) if (callback) callback(!migrationNeeded);
                });
            }
        }

        var compareMaster = function (name, sql, callback) {
            database.prepare("SELECT name, hash, salt FROM entities_master WHERE name=?", name).all(function (err, row) {
                if (err) sqlite3Context.emit("error", err);
                var hmac = new Blackfeather.Security.Cryptology.Hmac().Compute("table_hash", sql, row[0].salt);

                if (hmac.Data.toString() != row[0].hash) {
                    if (callback) callback(false);
                    return;
                }

                if (callback) callback(true);
            });
        };

        var executeMigration = function() {
            sqlite3Context.migrated = true;

            switch (migrate) {
                case migrationPlan.HaltOnChange:
                    throw "A table, or, model has been changed, and, no longer valid.";
                case migrationPlan.CreateOnChange:
                    seed();
                    break;
                case migrationPlan.AlterOnChange:
                    throw "This migration action has not been created yet!";
            }
        };

        comparePhysicalMigration(function (valid) {
            if (valid) {
                physicalMigrationValid = true;

                if (physicalMigrationValid && objectMigrationValid) {
                    createMappings();
                }
                return;
            }

            executeMigration();
        });

        compareModelMigration(function (valid) {
            if (valid) {
                objectMigrationValid = true;

                if (physicalMigrationValid && objectMigrationValid) {
                    createMappings();
                }
                return;
            }

            executeMigration();
        })
    }

    setTimeout(function () {
        tableExists("entities_master", function (exists) {
            if (!exists) {
                seed();
                return;
            }

            migrate();
        });
    }, 1);

    events.call(this);
};

util.inherits(sqlite3Context, events);
module['exports'] = sqlite3Context;