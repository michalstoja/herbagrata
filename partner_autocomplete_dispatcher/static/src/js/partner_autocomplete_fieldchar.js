/** @odoo-module **/
/**
    Data Dance Proprietary License v1.0

    This software and associated files (the "Software") may only be used
    (executed, modified, executed after modifications) if you have
    purchased a valid license from Data Dance s.r.o.

    The above permissions are granted for a single database per purchased
    license. Furthermore, with a valid license it is permitted to use the
    software on other databases as long as the usage is limited to a testing
    or development environment.

    You may develop modules based on the Software or that use the Software
    as a library (typically by depending on it, importing it and using its
    resources), but without copying any source code or material from the
    Software. You may distribute those modules under the license of your
    choice, provided that this license is compatible with the terms of the
    Data Dance Proprietary License (For example: LGPL, MIT, or proprietary
    licenses similar to this one).

    It is forbidden to publish, distribute, sublicense, or sell copies of
    the Software or modified copies of the Software.

    The above copyright notice and this permission notice must be included
    in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
    OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
    THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
    DEALINGS IN THE SOFTWARE.
 */

import { PartnerAutoCompleteCharField } from '@partner_autocomplete/js/partner_autocomplete_fieldchar';
import { deserializeDate, deserializeDateTime } from "@web/core/l10n/dates";
import { PyDate, PyDateTime } from "@web/core/py_js/py_date";
import { patch } from "@web/core/utils/patch";

patch(PartnerAutoCompleteCharField.prototype, {
    async onSelectPartnerAutocompleteOption(option) {
        let data = await this.partnerAutocomplete.getCreateData(option);
        if (!data?.company) {
            return;
        }

        if (data.logo) {
            const logoField = this.props.record.resModel === 'res.partner' ? 'image_1920' : 'logo';
            data.company[logoField] = data.logo;
        }

        // Format the many2one fields
        const many2oneFields = ['country_id', 'state_id', 'industry_id'];
        many2oneFields.forEach((field) => {
            if (data.company[field]) {
                data.company[field] = [data.company[field].id, data.company[field].display_name];
            }
        });

        // Fix Date and DateTime fields as they are expected in JS
        Object.keys(data.company).forEach(async (field) => {
            if ((field in this.props.record.fields) && (this.props.record.fields[field].type == "date")) {
                data.company[field] = deserializeDate(data.company[field]);
            }
            if ((field in this.props.record.fields) && (this.props.record.fields[field].type == "datetime")) {
                data.company[field] = deserializeDateTime(data.company[field]);
            }
            if ((field in this.props.record.fields) && (this.props.record.fields[field].type == "one2many")) {
                let model_fields = await this.props.record.model.orm.call(
                    this.props.record.fields[field].relation,
                    'fields_get',
                    [],
                );
                for (let i = 0; i < data.company[field].length; i++) {
                    if (data.company[field][i][0] == 0) {
                        Object.keys(data.company[field][i][2]).forEach((subfield) => {
                            if (model_fields[subfield].type == "date") {
                                data.company[field][i][subfield] = PyDate.convertDate(deserializeDate(data.company[field][i][subfield]).toJSDate());

                            }
                            if (model_fields[subfield].type == "datetime") {
                                data.company[field][i][subfield] = PyDateTime.convertDate(deserializeDateTime(data.company[field][i][subfield]).toJSDate());

                            }
                        });
                    }
                }
            }
        });

        // Save UNSPSC codes (tags)
        const unspsc_codes = data.company.unspsc_codes

        // Delete useless fields before updating record
        data.company = this.partnerAutocomplete.removeUselessFields(data.company, Object.keys(this.props.record.fields));

        // Update record with retrieved values
        if (data.company.name) {
            await this.props.record.update({ name: data.company.name });  // Needed otherwise name it is not saved
        }
        await this.props.record.update(data.company);


        // Add UNSPSC codes (tags)
        if (this.props.record.resModel === 'res.partner' && unspsc_codes) {
            // We must first save the record so that we can then create the tags (many2many)
            const saved = await this.props.record.save();
            if (saved) {
                await this.props.record.load();
                await this.orm.call("res.partner", "iap_partner_autocomplete_add_tags", [this.props.record.resId, unspsc_codes]);
                await this.props.record.load();
            }
        }
        if (this.props.setDirty) {
            this.props.setDirty(false);
        }
    },

});
