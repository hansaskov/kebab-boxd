# Architecture

The Hexagonal Architecture, also referred to as Ports and Adapters, is an architectural pattern that allows input by users or external systems to arrive into the Core at a Port via an Adapter, and allows output to be sent out from the Core through a Port to an Adapter. This creates an abstraction layer that protects the core of an application and isolates it from external and somehow irrelevant tools and technologies.

## Core
The center of the Architecture. It handles the business logic and uses ports to receive and send commands to adapters.

## Ports
Describes the behavior the core needs, never how. Two adapters can satisfy the same Port with entirely different implementation and the core would not notice, or care. Ports can also be seen as interfaces.  

There are two Ports in this project:

**Persistence Port.** The core uses the persistance port to store and retrieve data. Which database, which ORM, which schema is implemented by the adapter and is unknown to the core.

**Application Port.** The core uses the application port to expose business logic to applications adapters. Authentication, User management and other logic is exposed here.  


## Adapters

An Adapter will initiate the interaction with the Core through a Port, using a specific technology, for example, a REST adapter will allow a client to communicate with the Core over HTTPS and REST. There can be as many Adapters for any single Port as needed without this representing a risk to the Ports or the Application itself.

There are four Adapters in this project. 
**Astro Adapter**
**Sqlite Adapter**

**Persistance-Testing Adapter**
**Application-Testing Adapter**


## Repository layout

tbd