import { Transform, StitchingInfo, DelegationContext } from './types';

import AddSelectionSets from './transforms/AddSelectionSets';
import ExpandAbstractTypes from './transforms/ExpandAbstractTypes';
import WrapConcreteTypes from './transforms/WrapConcreteTypes';
import FilterToSchema from './transforms/FilterToSchema';
import AddTypenameToAbstract from './transforms/AddTypenameToAbstract';
import CheckResultAndHandleErrors from './transforms/CheckResultAndHandleErrors';
import AddArgumentsAsVariables from './transforms/AddArgumentsAsVariables';
import StoreDeferredSelectionSets from './transforms/StoreDeferredSelectionSets';
import UndeferSelections from './transforms/UndeferSelections';

export function defaultDelegationBinding(delegationContext: DelegationContext): Array<Transform> {
  let delegationTransforms: Array<Transform> = [new CheckResultAndHandleErrors()];

  const info = delegationContext.info;
  const stitchingInfo: StitchingInfo = info?.schema.extensions?.stitchingInfo;

  if (stitchingInfo != null) {
    delegationTransforms = delegationTransforms.concat([
      new ExpandAbstractTypes(),
      new AddSelectionSets(
        stitchingInfo.selectionSetsByType,
        stitchingInfo.selectionSetsByField,
        stitchingInfo.dynamicSelectionSetsByField
      ),
      new WrapConcreteTypes(),
    ]);
  } else if (info != null) {
    delegationTransforms = delegationTransforms.concat([new WrapConcreteTypes(), new ExpandAbstractTypes()]);
  } else {
    delegationTransforms.push(new WrapConcreteTypes());
  }

  delegationTransforms.push(new StoreDeferredSelectionSets());

  const transforms = delegationContext.transforms;
  if (transforms != null) {
    delegationTransforms = delegationTransforms.concat(transforms.slice().reverse());
  }

  const args = delegationContext.args;
  if (args != null) {
    delegationTransforms.push(new AddArgumentsAsVariables(args));
  }

  delegationTransforms = delegationTransforms.concat([
    new FilterToSchema(),
    new AddTypenameToAbstract(),
    new UndeferSelections(),
  ]);

  return delegationTransforms;
}
