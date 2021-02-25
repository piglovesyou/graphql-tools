import {
  GraphQLResolveInfo,
  getNullableType,
  isCompositeType,
  isLeafType,
  isListType,
  GraphQLError,
  GraphQLSchema,
  GraphQLCompositeType,
  isAbstractType,
  GraphQLList,
  GraphQLType,
  locatedError,
} from 'graphql';

import AggregateError from '@ardatan/aggregate-error';

import { StitchingInfo, SubschemaConfig } from './types';
import { annotateExternalObject, isExternalObject } from './externalObjects';
import { getFieldsNotInSubschema } from './getFieldsNotInSubschema';
import { mergeFields } from './mergeFields';
import { Subschema } from './Subschema';
import { Receiver } from './Receiver';

export function resolveExternalValue(
  result: any,
  unpathedErrors: Array<GraphQLError>,
  subschema: GraphQLSchema | SubschemaConfig,
  context: Record<string, any>,
  info: GraphQLResolveInfo,
  receiver?: Receiver,
  returnType = info?.returnType,
  skipTypeMerging?: boolean
): any {
  const type = getNullableType(returnType);

  if (result instanceof Error) {
    return result;
  }

  if (result == null) {
    return reportUnpathedErrorsViaNull(unpathedErrors);
  }

  if (isLeafType(type)) {
    return type.parseValue(result);
  } else if (isCompositeType(type)) {
    return resolveExternalObject(type, result, unpathedErrors, subschema, context, info, receiver, skipTypeMerging);
  } else if (isListType(type)) {
    return resolveExternalList(type, result, unpathedErrors, subschema, context, info, receiver, skipTypeMerging);
  }
}

function resolveExternalObject(
  type: GraphQLCompositeType,
  object: any,
  unpathedErrors: Array<GraphQLError>,
  subschema: GraphQLSchema | SubschemaConfig,
  context: Record<string, any>,
  info: GraphQLResolveInfo,
  receiver?: Receiver,
  skipTypeMerging?: boolean
) {
  // if we have already resolved this object, for example, when the identical object appears twice
  // in a list, see https://github.com/ardatan/graphql-tools/issues/2304
  if (isExternalObject(object)) {
    return object;
  }

  annotateExternalObject(object, unpathedErrors, subschema, receiver);

  const stitchingInfo: StitchingInfo = info?.schema.extensions?.stitchingInfo;
  if (skipTypeMerging || !stitchingInfo) {
    return object;
  }

  let typeName: string;

  if (isAbstractType(type)) {
    const resolvedType = info.schema.getTypeMap()[object.__typename];
    if (resolvedType == null) {
      throw new Error(
        `Unable to resolve type '${object.__typename}'. Did you forget to include a transform that renames types? Did you delegate to the original subschema rather that the subschema config object containing the transform?`
      );
    }
    typeName = resolvedType.name;
  } else {
    typeName = type.name;
  }

  const mergedTypeInfo = stitchingInfo.mergedTypes[typeName];
  let targetSubschemas: Array<Subschema>;

  // Within the stitching context, delegation to a stitched GraphQLSchema or SubschemaConfig
  // will be redirected to the appropriate Subschema object, from which merge targets can be queried.
  if (mergedTypeInfo != null) {
    targetSubschemas = mergedTypeInfo.targetSubschemas.get(subschema as Subschema);
  }

  // If there are no merge targets from the subschema, return.
  if (!targetSubschemas) {
    return object;
  }

  const fieldsAndPatches = getFieldsNotInSubschema(info, subschema, mergedTypeInfo);

  return mergeFields(
    mergedTypeInfo,
    typeName,
    object,
    fieldsAndPatches,
    subschema as Subschema,
    targetSubschemas,
    context,
    info
  );
}

function resolveExternalList(
  type: GraphQLList<any>,
  list: Array<any>,
  unpathedErrors: Array<GraphQLError>,
  subschema: GraphQLSchema | SubschemaConfig,
  context: Record<string, any>,
  info: GraphQLResolveInfo,
  receiver?: Receiver,
  skipTypeMerging?: boolean
) {
  return list.map(listMember =>
    resolveExternalListMember(
      getNullableType(type.ofType),
      listMember,
      unpathedErrors,
      subschema,
      context,
      info,
      receiver,
      skipTypeMerging
    )
  );
}

function resolveExternalListMember(
  type: GraphQLType,
  listMember: any,
  unpathedErrors: Array<GraphQLError>,
  subschema: GraphQLSchema | SubschemaConfig,
  context: Record<string, any>,
  info: GraphQLResolveInfo,
  receiver?: Receiver,
  skipTypeMerging?: boolean
): any {
  if (listMember instanceof Error) {
    return listMember;
  }

  if (listMember == null) {
    return reportUnpathedErrorsViaNull(unpathedErrors);
  }

  if (isLeafType(type)) {
    return type.parseValue(listMember);
  } else if (isCompositeType(type)) {
    return resolveExternalObject(type, listMember, unpathedErrors, subschema, context, info, receiver, skipTypeMerging);
  } else if (isListType(type)) {
    return resolveExternalList(type, listMember, unpathedErrors, subschema, context, info, receiver, skipTypeMerging);
  }
}

const reportedErrors: WeakMap<GraphQLError, boolean> = new Map();

function reportUnpathedErrorsViaNull(unpathedErrors: Array<GraphQLError>) {
  if (unpathedErrors.length) {
    const unreportedErrors: Array<GraphQLError> = [];
    unpathedErrors.forEach(error => {
      if (!reportedErrors.has(error)) {
        unreportedErrors.push(error);
        reportedErrors.set(error, true);
      }
    });

    if (unreportedErrors.length) {
      if (unreportedErrors.length === 1) {
        return unreportedErrors[0];
      }

      const combinedError = new AggregateError(unreportedErrors);
      return locatedError(combinedError, undefined, unreportedErrors[0].path);
    }
  }

  return null;
}
