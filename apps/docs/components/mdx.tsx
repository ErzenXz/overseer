import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import {
  Accordion,
  AccordionGroup,
  Card,
  CardGroup,
  Cards,
  CheckItem,
  InfoCallout,
  Note,
  ParamField,
  Step,
  Steps,
  Tab,
  Tabs,
  Tip,
  Warning,
} from './docs-ui';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Card,
    CardGroup,
    Cards,
    Accordion,
    AccordionGroup,
    Tabs,
    Tab,
    Tip,
    Info: InfoCallout,
    Warning,
    Check: CheckItem,
    Steps,
    Step,
    Note,
    ParamField,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
