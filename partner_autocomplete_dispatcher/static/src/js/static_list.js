/** @odoo-module **/
import { x2ManyCommands } from "@web/core/orm_service";
import { patch } from "@web/core/utils/patch";
import { StaticList } from "@web/model/relational_model/static_list";
import { getId } from "@web/model/relational_model/utils";



patch(StaticList.prototype, {
    setup() {
        super.setup(...arguments);
    },

    _applyCommands(commands, { canAddOverLimit, reload } = {}) {
        const { CREATE, UPDATE, DELETE, UNLINK, LINK, SET, CLEAR } = x2ManyCommands;

        // For performance reasons, we split commands by record ids, such that we have quick access
        // to all commands concerning a given record. At the end, we re-build the list of commands
        // from this structure.
        let lastCommandIndex = -1;
        const commandsByIds = {};
        function addOwnCommand(command) {
            commandsByIds[command[1]] = commandsByIds[command[1]] || [];
            commandsByIds[command[1]].push({ command, index: ++lastCommandIndex });
        }
        function getOwnCommands(id) {
            commandsByIds[id] = commandsByIds[id] || [];
            return commandsByIds[id];
        }
        for (const command of this._commands) {
            addOwnCommand(command);
        }

        // For performance reasons, we accumulate removed ids (commands DELETE and UNLINK), and at
        // the end, we filter once this.records and this._currentIds to remove them.
        const removedIds = {};
        const recordsToLoad = [];
        for (const command of commands) {
            switch (command[0]) {
                case CREATE: {
                    const virtualId = getId("virtual");
                    const record = this._createRecordDatapoint(command[2], { virtualId });
                    this.records.push(record);
                    addOwnCommand([CREATE, virtualId]);
                    const index = this.offset + this.limit + this._tmpIncreaseLimit;
                    this._currentIds.splice(index, 0, virtualId);
                    this._tmpIncreaseLimit = Math.max(this.records.length - this.limit, 0);
                    const nextLimit = this.limit + this._tmpIncreaseLimit;
                    this.model._updateConfig(this.config, { limit: nextLimit }, { reload: false });
                    this.count++;
                    break;
                }
                case UPDATE: {
                    const existingCommand = getOwnCommands(command[1]).some(
                        (x) => x.command[0] === CREATE || x.command[0] === UPDATE
                    );
                    if (!existingCommand) {
                        addOwnCommand([UPDATE, command[1]]);
                    }
                    const record = this._cache[command[1]];
                    if (!record) {
                        // the record isn't in the cache, it means it is on a page we haven't loaded
                        // so we say the record is "unknown", and store all update commands we
                        // receive about it in a separated structure, s.t. we can easily apply them
                        // later on after loading the record, if we ever load it.
                        if (!(command[1] in this._unknownRecordCommands)) {
                            this._unknownRecordCommands[command[1]] = [];
                        }
                        this._unknownRecordCommands[command[1]].push(command);
                    } else if (command[1] in this._unknownRecordCommands) {
                        // this case is more tricky: the record is in the cache, but it isn't loaded
                        // yet, as we are currently loading it (see below, where we load missing
                        // records for the current page)
                        this._unknownRecordCommands[command[1]].push(command);
                    } else {
                        const changes = {};
                        for (const fieldName in command[2]) {
                            if (["one2many", "many2many"].includes(this.fields[fieldName].type)) {
                                const invisible = record.activeFields[fieldName]?.invisible;
                                if (
                                    invisible === "True" ||
                                    invisible === "1" ||
                                    !(fieldName in record.activeFields) // this record hasn't been extended
                                ) {
                                    if (!(command[1] in this._unknownRecordCommands)) {
                                        this._unknownRecordCommands[command[1]] = [];
                                    }
                                    this._unknownRecordCommands[command[1]].push(command);
                                    continue;
                                }
                            }
                            changes[fieldName] = command[2][fieldName];
                        }
                        record._applyChanges(record._parseServerValues(changes, record.data));
                    }
                    break;
                }
                case DELETE:
                case UNLINK: {
                    // If we receive an UNLINK command and we already have a SET command
                    // containing the record to unlink, we just remove it from the SET command.
                    // If there's a SET command, we know it's the first one (see @_replaceWith).
                    if (command[0] === UNLINK) {
                        const firstCommand = this._commands[0];
                        const hasReplaceWithCommand = firstCommand && firstCommand[0] === SET;
                        if (hasReplaceWithCommand && firstCommand[2].includes(command[1])) {
                            firstCommand[2] = firstCommand[2].filter((id) => id !== command[1]);
                            break;
                        }
                    }
                    const ownCommands = getOwnCommands(command[1]);
                    if (command[0] === DELETE) {
                        const hasCreateCommand = ownCommands.some((x) => x.command[0] === CREATE);
                        ownCommands.splice(0); // reset to the empty list
                        if (!hasCreateCommand) {
                            addOwnCommand([DELETE, command[1]]);
                        }
                    } else {
                        const linkToIndex = ownCommands.findIndex((x) => x.command[0] === LINK);
                        if (linkToIndex >= 0) {
                            ownCommands.splice(linkToIndex, 1);
                        } else {
                            addOwnCommand([UNLINK, command[1]]);
                        }
                    }
                    removedIds[command[1]] = true;
                    break;
                }
                case LINK: {
                    let record;
                    if (command[1] in this._cache) {
                        record = this._cache[command[1]];
                    } else {
                        record = this._createRecordDatapoint({ ...command[2], id: command[1] });
                    }
                    if (!this.limit || this.records.length < this.limit || canAddOverLimit) {
                        if (!command[2]) {
                            recordsToLoad.push(record);
                        }
                        this.records.push(record);
                        if (this.records.length > this.limit) {
                            this._tmpIncreaseLimit = this.records.length - this.limit;
                            const nextLimit = this.limit + this._tmpIncreaseLimit;
                            this.model._updateConfig(
                                this.config,
                                { limit: nextLimit },
                                { reload: false }
                            );
                        }
                    }
                    this._currentIds.push(record.resId);
                    addOwnCommand([command[0], command[1]]);
                    this.count++;
                    break;
                }
                case CLEAR: {
                    this.records = [];
                    this._currentIds = [];
                    this._commands = [];
                    this.count = 0;
                    break;
                }
            }
        }

        // Re-generate the new list of commands
        this._commands = Object.values(commandsByIds)
            .flat()
            .sort((x, y) => x.index - y.index)
            .map((x) => x.command);

        // Filter out removed records and ids from this.records and this._currentIds
        if (Object.keys(removedIds).length) {
            let removeCommandsByIdsCopy = Object.assign({}, removedIds);
            this.records = this.records.filter((r) => {
                const id = r.resId || r._virtualId;
                if (removeCommandsByIdsCopy[id]) {
                    delete removeCommandsByIdsCopy[id];
                    return false;
                }
                return true;
            });
            const nextCurrentIds = [];
            removeCommandsByIdsCopy = Object.assign({}, removedIds);
            for (const id of this._currentIds) {
                if (removeCommandsByIdsCopy[id]) {
                    delete removeCommandsByIdsCopy[id];
                } else {
                    nextCurrentIds.push(id);
                }
            }
            this._currentIds = nextCurrentIds;
            this.count = this._currentIds.length;
        }

        // Fill the page if it isn't full w.r.t. the limit. This may happen if we aren't on the last
        // page and records of the current have been removed, or if we applied commands to remove
        // some records and to add others, but we were on the limit.
        const nbMissingRecords = this.limit - this.records.length;
        if (nbMissingRecords > 0) {
            const lastRecordIndex = this.limit + this.offset;
            const firstRecordIndex = lastRecordIndex - nbMissingRecords;
            const nextRecordIds = this._currentIds.slice(firstRecordIndex, lastRecordIndex);
            for (const id of this._getResIdsToLoad(nextRecordIds)) {
                const record = this._createRecordDatapoint({ id }, { dontApplyCommands: true });
                recordsToLoad.push(record);
            }
            for (const id of nextRecordIds) {
                this.records.push(this._cache[id]);
            }
        }
        if (recordsToLoad.length || reload) {
            const resIds = reload
                ? this.records.map((r) => r.resId)
                : recordsToLoad.map((r) => r.resId);
            return this.model._loadRecords({ ...this.config, resIds }).then((recordValues) => {
                if (reload) {
                    for (const record of recordValues) {
                        this._createRecordDatapoint(record);
                    }
                    this.records = resIds.map((id) => this._cache[id]);
                    return;
                }
                for (let i = 0; i < recordsToLoad.length; i++) {
                    const record = recordsToLoad[i];
                    record._applyValues(recordValues[i]);
                    const commands = this._unknownRecordCommands[record.resId];
                    if (commands) {
                        delete this._unknownRecordCommands[record.resId];
                        this._applyCommands(commands);
                    }
                }
            });
        }
    }

});