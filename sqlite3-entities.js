var sqlite3 = require('sqlite3').verbose(),
    events = require('events'),
    util = require('util'),
    Blackfeather = require('Blackfeather');

var sqlite3Context = function (connectionString, options) {
    if (!options) options = {};
    var sqlite3Context = this;
    var database = this.database = options && options.cached == true ? new sqlite3.cached.Database(connectionString) : new sqlite3.Database(connectionString);
    var seeder = [];
    var tables = [];

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
            seeder = [];
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

    var inferType = function (value) {
        if (typeof value == "boolean") return "INTEGER";
        if (/^-?[\d.]+(?:e-?\d+)?$/.test(value)) return "INTEGER";
        if (typeof value == "string") return "TEXT";
        if (Array.isArray(value)) return "TEXT";
        if (typeof value == "object") return "TEXT";
        return "BLOB";
    }

    var inferDefault = function (value) {
        if (typeof value == "boolean") return false;
        if (/^-?[\d.]+(?:e-?\d+)?$/.test(value)) return 0;
        if (typeof value == "string") return "";
        if (Array.isArray(value)) return [];
        if (typeof value == "object") return {};
        return null;
    }

    var inferFromConvertable = function (tableName, column, value) {
        for (var i in tables) {
            if (tableName == tables[i].name) {
                for (var o in tables[i].scheme) {
                    if (o == column) {
                        var type = tables[i].scheme[o];
                        if (typeof type == "boolean") {
                            if (typeof value == 'boolean') return value;
                            if (typeof value == 'number') {
                                if (value == 0) return false;
                                if (value == 1) return true;
                            }

                            if (typeof value != 'string') throw "Can't convert value for '" + column + "' to boolean.";
                            if (value == "0" || value == "false") return false;
                            if (value == "1" || value == "true") return true;
                        }

                        if (/^-?[\d.]+(?:e-?\d+)?$/.test(type)) {
                            if (/^-?[\d.]+(?:e-?\d+)?$/.test(value)) {
                                return Number(value);
                            } else {
                                throw "Can't convert value for '" + column + "' to number.";
                            }
                        }

                        if (typeof type == "string") return value.toString();
                        if (Array.isArray(type)) {
                            if (typeof value == "string") return JSON.parse(value);
                            return value;
                        }

                        if (typeof type == "object") {
                            if (typeof value == "string") return JSON.parse(value);
                            return value;
                        }
                    }
                }
            }
        }

        throw "Unable to convert an unknown type.";
    }

    var inferToConvertable = function (tableName, column, value) {
        for (var i in tables) {
            if (tableName == tables[i].name) {
                for (var o in tables[i].scheme) {
                    if (o == column) {
                        var type = tables[i].scheme[o];
                        if (typeof type == "boolean") {
                            if (typeof value == 'boolean') return value;
                            if (typeof value != 'string') throw "Can't convert value for '" + column + "' to boolean."
                            if (value == "0" || value == "false") return false;
                            if (value == "1" || value == "true") return true;
                        }

                        if (/^-?[\d.]+(?:e-?\d+)?$/.test(type)) {
                            if (/^-?[\d.]+(?:e-?\d+)?$/.test(value)) {
                                return Number(value)
                            } else {
                                throw "Can't convert value for '" + column + "' to number."
                            }
                        }

                        if (typeof type == "string") return value.toString();
                        if (Array.isArray(type)) return JSON.stringify(value);
                        if (typeof type == "object") return JSON.stringify(value);
                    }
                }
            }
        }

        throw "Unable to convert an unknown type.";
    }

    var createTable = function (tableModel) {
        if (!tableModel["name"] || !tableModel["scheme"]) throw "Invalid table model!";

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
                        constraints += " ";
                    } else {
                        constraints += ", ";
                    }

                    constraints += "CONSTRAINT " + property + "_unique UNIQUE (" + property + ")";
                }

                if (mapping && mapping["foreign"]) {
                    if (constraints == "") {
                        constraints += " ";
                    } else {
                        constraints += ", ";
                    }

                    constraints += "FOREIGN KEY(" + property + ") REFERENCES " + mapping.foreign.table + "(" + mapping.foreign.column + ")";
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

                sqlite3Context[rows[i].name] = new tableEntity(rows[i].name);
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

    var createRowEntity = function (tableName, row) {
        var entity = null;
        for (var i in tables) {
            if (tableName == tables[i].name) {
                entity = {};
                for (var o in tables[i].scheme) {
                    if (row.hasOwnProperty(o)) {
                        entity[o] = inferFromConvertable(tableName, o, row[o]);
                    } else {
                        entity[o] = inferDefault(tables[i].scheme[o]);
                    }
                }
            }
        }

        return entity;
    }

    var rowsEntity = function (tableName, rows) {
        var toString = this.toString = function () {
            return JSON.stringify({ table: tableName, rows: rows });
        }

        var toList = this.toList = function () {
            if (!tableName || !rows) return null;
            return rows;
        }

        var first = this.first = function (condition) {
            if (!tableName || !rows) return null;

            var value = null;
            if (condition) {
                for (var i in rows) {
                    if (condition(rows[i])) {
                        value = createRowEntity(tableName, rows[i]);
                        break;
                    }
                }
            } else {
                if (rows.length > 0) {
                    value = createRowEntity(tableName, rows[0]);
                }
            }

            return value;
        }

        var last = this.last = function (condition) {
            if (!tableName || !rows) return null;

            if (rows.length == 0) {
                return null;
            }

            var value = null;
            if (condition) {
                for (var i in rows) {
                    if (condition(rows[i])) {
                        value = createRowEntity(tableName, rows[i]);
                        break;
                    }
                }
            } else {
                if (rows.length > 0) {
                    value = createRowEntity(tableName, rows[rows.length - 1]);
                }
            }

            return value;
        }

        var where = this.where = function (condition) {
            if (!tableName || !rows) return null;

            if (rows.length == 0) {
                return null;
            }

            var list = [];
            for (var i in rows) {
                if (condition(rows[i])) {
                    list.push(createRowEntity(tableName, rows[i]));
                    break;
                }
            }

            return createRowsEntity(tableName, list);
        }

        var count = this.count = function (condition) {
            if (!tableName || !rows) return null;

            if (rows.length == 0) {
                return null;
            }

            var value = 0;
            if (condition) {
                for (var i in rows) {
                    if (condition(rows[i])) {
                        value++;
                        break;
                    }
                }
            } else {
                value = rows.length;
            }

            return value;
        }
    }

    var tableEntity = function (tableName) {
        var tableEntity = this;
        var rowColumns = "*";

        var select = this.select = function (columns) {
            var columnList = "";
            if (!columns) {
                tableEntity.rowColumns = "*";
                return;
            } else {
                if (typeof (columns) == "string") {
                    rowColumns = columns;
                    return tableEntity;
                } else {
                    for (var i in columns) {
                        if (columnList != "") {
                            columnList += ", ";
                        }

                        columnList += columns[i];
                    }
                }

            }

            if (columnList != "") tableEntity.rowsColumns = columnList;
            return tableEntity;
        }

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

                var inferred = inferToConvertable(tableName, column, row[column]);
                //console.log(inferred);
                value.push(inferred);
            }

            database.prepare("INSERT INTO '" + tableName + "' (" + columns + ") VALUES (" + values + ")").run(value, function (err) {
                if (err) sqlite3Context.emit("error", err);
                if (callback) callback();
            });

            return tableEntity;
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

            return tableEntity;
        }

        var first = this.first = function (condition, callback) {
            database.prepare("SELECT " + tableEntity.rowsColumns + " FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var conditioned = false;
                for (var i in rows) {
                    var entity = createRowEntity(tableName, rows[i]);
                    if (condition(entity)) {
                        conditioned = true;
                        if (callback) callback(entity);
                        break;
                    }
                }

                if (!conditioned) {
                    if (callback) callback(null);
                }
            });

            return tableEntity;
        }

        var last = this.last = function (condition, callback) {
            database.prepare("SELECT " + tableEntity.rowsColumns + " FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var list = [];
                for (var i in rows) {
                    var entity = createRowEntity(tableName, rows[i]);
                    if (condition(entity)) {
                        list.push(entity);
                    }
                }

                if (callback) callback(list[list.length]);
            });

            return tableEntity;
        }

        var where = this.where = function (condition, callback) {
            database.prepare("SELECT " + tableEntity.rowsColumns + " FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);
                var list = [];
                for (var i in rows) {
                    list.push(createRowEntity(tableName, rows[i]));
                }

                if (callback) callback(new rowsEntity(tableName, list));
            });

            return tableEntity;
        }

        var count = this.count = function (condition, callback) {
            database.prepare("SELECT " + tableEntity.rowsColumns + " FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var index = 0;
                for (var i in rows) {
                    if (condition(rows[i])) {
                        index++;
                    }
                }

                if (callback) callback(index);
            });

            return tableEntity;
        }

        var all = this.all = function (callback) {
            database.prepare("SELECT " + tableEntity.rowsColumns + " FROM '" + tableName + "'").all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);
                if (callback) callback(rows);
            });

            return tableEntity;
        };
    }

    var migration = this.migration = function () {
        var changed = false;

        var accept = this.accept = function () {
            if (changed) {
                database.prepare("DELETE FROM 'entities_master'").run(function () {
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

                        sqlite3Context.migrated = true;
                        createMappings();
                    });
                });
                return;
            }

            createMappings();
        }

        var prepare = this.prepare = function (sql) {
            seeder.push(database.prepare(sql));
        }

        var run = this.run = function (callback) {
            changed = true;
            ensure(seeder, 0, function () {
                seeder = [];
                if (callback) callback();
            });
        }

        var reject = this.reject = function (reason) {
            if (reason) throw "Migration rejected: " + reason;
            throw "Migration rejected."
        }
    }

    var migrate = function () {
        var physicalMigrationValid = false;
        var objectMigrationValid = false;
        var migrationNeeded = [];

        var comparePhysicalMigration = function (callback) {
            var query = database.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'");
            query.all(function (err, rows) {
                if (err) sqlite3Context.emit("error", err);

                var validated = 0;
                for (var i in rows) {
                    var tableRow = rows[i];
                    if (tableRow.name == "sqlite_sequence" || tableRow.name == "entities_master") {
                        continue;
                    }

                    compareMaster(tableRow.name, tableRow.sql, function (valid) {
                        validated++;
                        if (!valid) migrationNeeded.push(tableRow.name);
                        if (validated + 2 == rows.length) if (callback) callback(migrationNeeded);
                    });
                }
            });
        };

        var compareModelMigration = function (callback) {
            var validated = 0;

            for (var i = 0; i <= tables.length - 1; i++) {
                var tableObject = tables[i];
                var sql = createTable(tableObject);
                sql = sql.replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE"); // TODO: Dirty, fix this! SQLite 3 ommits the IF NOT EXISTS part in master

                compareMaster(tableObject.name, sql, function (valid) {
                    validated++;
                    if (!valid) migrationNeeded.push(tableObject.name);
                    if (validated == tables.length) if (callback) callback(migrationNeeded);
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

        var executeAutoMigration = function () {
            if (!options || !options.autoMigration) return;
            sqlite3Context.migrated = true;

            switch (options.autoMigration) {
                default:
                case 0:
                    throw "A table, or, model has been changed, and, no longer valid.";
                case 1:
                    seed();
                    break;
                case 3:
                    throw "This migration action has not been created yet!";
            }
        };

        comparePhysicalMigration(function (differences) {
            if (differences.length == 0) {
                physicalMigrationValid = true;

                if (physicalMigrationValid && objectMigrationValid) {
                    createMappings();
                }
                return;
            }

            if (options && options.autoMigration) return executeAutoMigration();
            sqlite3Context.emit("migration", differences);
        });

        compareModelMigration(function (differences) {
            if (differences.length == 0) {
                objectMigrationValid = true;

                if (physicalMigrationValid && objectMigrationValid) {
                    createMappings();
                }
                return;
            }

            if (options && options.autoMigration) return executeAutoMigration();
            sqlite3Context.emit("migration", differences);
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