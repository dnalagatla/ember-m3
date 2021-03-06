import { dasherize } from '@ember/string';
import M3ReferneceArray from './m3-reference-array';
import M3TrackedArray from './m3-tracked-array';
import { EmbeddedInternalModel, EmbeddedMegamorphicModel } from './model';
import { A } from '@ember/array';

export function computeAttributeReference(key, value, modelName, schemaInterface, schema) {
  schemaInterface._beginDependentKeyResolution(key);
  let reference = schema.computeAttributeReference(key, value, modelName, schemaInterface);
  schemaInterface._endDependentKeyResolution(key);
  return reference;
}

function computeNestedModel(key, value, modelName, schemaInterface, schema) {
  schemaInterface._beginDependentKeyResolution(key);
  let nestedModel = schema.computeNestedModel(key, value, modelName, schemaInterface);
  schemaInterface._endDependentKeyResolution(key);
  return nestedModel;
}

function resolveReference(store, reference) {
  if (reference.type === null) {
    // for schemas with a global id-space but multiple types, schemas may
    // report a type of null
    let internalModel = store._globalM3Cache[reference.id];
    return internalModel ? internalModel.getRecord() : null;
  } else {
    // respect the user schema's type if provided
    return store.peekRecord(reference.type, reference.id);
  }
}

function resolveReferenceOrReferences(store, model, key, value, reference) {
  if (Array.isArray(value) || Array.isArray(reference)) {
    return resolveRecordArray(store, model, key, reference);
  }

  return resolveReference(store, reference);
}

/**
 * There are two different type of values we have to worry about:
 * 1. References
 * 2. Nested Models
 *
 * Here is a mapping of input -> output:
 * 1. Single reference -> resolved reference
 * 2. Array of references -> RecordArray of resolved references
 * 3. Single nested model -> EmbeddedMegaMorphicModel
 * 4. Array of nested models -> array of EmbeddedMegaMorphicModel
 */
export function resolveValue(key, value, modelName, store, schema, model, parentIdx) {
  const schemaInterface = model._internalModel._modelData.schemaInterface;

  // First check to see if given value is either a reference or an array of references
  let reference = computeAttributeReference(key, value, modelName, schemaInterface, schema);
  if (reference !== undefined && reference !== null) {
    return resolveReferenceOrReferences(store, model, key, value, reference);
  }

  if (Array.isArray(value)) {
    return resolveArray(key, value, modelName, store, schema, model);
  }
  let nested = computeNestedModel(key, value, modelName, schemaInterface, schema);
  if (nested) {
    let internalModel = new EmbeddedInternalModel({
      // nested models with ids is pretty misleading; all they really ought to need is type
      id: nested.id,
      // maintain consistency with internalmodel.modelName, which is normalized
      // internally within ember-data
      modelName: nested.type ? dasherize(nested.type) : null,
      parentInternalModel: model._internalModel,
      parentKey: key,
      parentIdx,
    });

    let nestedModel = new EmbeddedMegamorphicModel({
      store,
      _internalModel: internalModel,
      _parentModel: model,
      _topModel: model._topModel,
    });
    internalModel.record = nestedModel;

    internalModel._modelData.pushData({
      attributes: nested.attributes,
    });

    return nestedModel;
  }

  return value;
}

// ie an array of nested models
export function resolveArray(key, value, modelName, store, schema, model) {
  let resolvedArray = new Array(0);
  if (value && value.length > 0) {
    resolvedArray = value.map((value, idx) =>
      resolveValue(key, value, modelName, store, schema, model, idx)
    );
  }

  return M3TrackedArray.create({
    content: A(resolvedArray),
    key,
    value,
    modelName,
    store,
    schema,
    model,
  });
}

export function resolveRecordArray(store, model, key, references) {
  let recordArrayManager = store._recordArrayManager;

  let array = M3ReferneceArray.create({
    modelName: '-ember-m3',
    content: A(),
    store: store,
    manager: recordArrayManager,
    key,
    model,
  });

  let internalModels = resolveReferencesWithInternalModels(store, references);

  array._setInternalModels(internalModels);
  return array;
}

export function resolveReferencesWithInternalModels(store, references) {
  // TODO: mention in UPGRADING.md
  return references.map(
    reference =>
      reference.type
        ? store._internalModelForId(dasherize(reference.type), reference.id)
        : store._globalM3Cache[reference.id]
  );
}
